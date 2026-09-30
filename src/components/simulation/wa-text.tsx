import { Fragment } from 'react';

/** Minimal WhatsApp formatting: *bold*, _italic_, line breaks. */
export function WaText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((chunk, j) => {
            if (/^\*[^*]+\*$/.test(chunk)) return <strong key={j}>{chunk.slice(1, -1)}</strong>;
            if (/^_[^_]+_$/.test(chunk)) return <em key={j}>{chunk.slice(1, -1)}</em>;
            return <Fragment key={j}>{chunk}</Fragment>;
          })}
        </Fragment>
      ))}
    </>
  );
}
