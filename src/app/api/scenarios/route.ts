import scenarios from '@/lib/data/scenarios.json';

/** End-to-end test scenarios generated from scenarios.csv (`npm run scenarios:build`). */
export async function GET() {
  return Response.json({ scenarios });
}
