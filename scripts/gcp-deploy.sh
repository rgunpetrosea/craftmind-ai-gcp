#!/usr/bin/env bash
# CraftMind AI on Google Cloud: one-time project setup + Cloud Run deploy.
#
#   PROJECT_ID=my-project REGION=asia-southeast2 ./scripts/gcp-deploy.sh setup    # APIs, Firestore, bucket, IAM, secret
#   PROJECT_ID=my-project REGION=asia-southeast2 ./scripts/gcp-deploy.sh deploy   # build from source + deploy
#
# Optional: SERVICE=craftmind  BUCKET=<project>-craftmind-media  GCS_PUBLIC_READ=true|false  CRAFTER_ID=crafter-leather-01
#           DESIGN_CRITIC=on (automatic critic loop; default off)
#
# Runtime shape (important): the WhatsApp message buffer (adaptive debounce) and the per-phone session lock live in
# process memory, and buffered turns are answered after the HTTP response returns. The service therefore runs as ONE
# always-on instance with CPU always allocated (--min/--max-instances 1, --no-cpu-throttling). Firestore + Cloud
# Storage hold all state, so a restart loses at most a buffer window in flight.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-southeast2}"
SERVICE="${SERVICE:-craftmind}"
BUCKET="${BUCKET:-${PROJECT_ID}-craftmind-media}"
GCS_PUBLIC_READ="${GCS_PUBLIC_READ:-true}"
SA_NAME="${SERVICE}-run"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

setup() {
  gcloud config set project "$PROJECT_ID"
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com

  # Firestore (Native mode); ignore "already exists"
  gcloud firestore databases create --location="$REGION" --type=firestore-native 2>/dev/null || echo "Firestore database already exists"

  # Media bucket (mockups, sketches, voice notes)
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" --uniform-bucket-level-access 2>/dev/null || echo "Bucket already exists"
  if [ "$GCS_PUBLIC_READ" = "true" ]; then
    # public read so WhatsApp Cloud API and the client gallery can fetch renders by URL
    gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member=allUsers --role=roles/storage.objectViewer
  fi

  # Runtime service account: Firestore, Storage, Secret Manager, Vertex AI (Imagen)
  gcloud iam service-accounts create "$SA_NAME" --display-name="CraftMind Cloud Run" 2>/dev/null || echo "Service account already exists"
  for role in roles/datastore.user roles/secretmanager.secretAccessor roles/aiplatform.user; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$role" --condition=None >/dev/null
  done
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member="serviceAccount:${SA}" --role=roles/storage.objectAdmin

  # Gemini API key as a secret (paste the key when prompted; skip if you use Vertex AI only)
  if ! gcloud secrets describe gemini-api-key >/dev/null 2>&1; then
    read -r -s -p "Gemini API key (empty to skip): " KEY; echo
    if [ -n "$KEY" ]; then printf '%s' "$KEY" | gcloud secrets create gemini-api-key --data-file=-; fi
  fi

  # Random secret that signs the crafter session cookie (without it the public dev default would be used)
  if ! gcloud secrets describe craftmind-auth-secret >/dev/null 2>&1; then
    head -c 48 /dev/urandom | base64 | tr -d '\n' | gcloud secrets create craftmind-auth-secret --data-file=-
  fi
}

deploy() {
  local mapped=()
  gcloud secrets describe gemini-api-key --project "$PROJECT_ID" >/dev/null 2>&1 && mapped+=("GEMINI_API_KEY=gemini-api-key:latest")
  gcloud secrets describe craftmind-auth-secret --project "$PROJECT_ID" >/dev/null 2>&1 && mapped+=("AUTH_SECRET=craftmind-auth-secret:latest")
  local secrets=()
  if [ "${#mapped[@]}" -gt 0 ]; then secrets=(--set-secrets "$(IFS=,; echo "${mapped[*]}")"); fi
  gcloud run deploy "$SERVICE" \
    --project "$PROJECT_ID" --region "$REGION" --source . \
    --service-account "$SA" --allow-unauthenticated \
    --min-instances 1 --max-instances 1 --no-cpu-throttling \
    --cpu 1 --memory 1Gi --timeout 300 --concurrency 40 \
    --set-env-vars "USE_FIRESTORE=true,GCS_BUCKET=${BUCKET},GCS_PUBLIC_READ=${GCS_PUBLIC_READ},GCP_PROJECT_ID=${PROJECT_ID},GCP_LOCATION=${REGION},DESIGN_CRITIC=${DESIGN_CRITIC:-off}${CRAFTER_ID:+,CRAFTER_ID=${CRAFTER_ID}}" \
    ${secrets[@]+"${secrets[@]}"}

  # absolute links (client gallery, /api/media in private-bucket mode) use the service URL
  local url
  url="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
  gcloud run services update "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --update-env-vars "PUBLIC_BASE_URL=${url}" >/dev/null
  echo "Deployed: ${url}  (crafter login: ${url}/login)"
}

case "${1:-}" in
  setup) setup ;;
  deploy) deploy ;;
  *) echo "usage: PROJECT_ID=... $0 setup|deploy" >&2; exit 1 ;;
esac
