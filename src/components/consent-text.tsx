import type { ConsentBlock } from "@/lib/consent";

/**
 * Renders the parsed consent blocks as plain HTML (no Markdown library).
 *
 * @param props.blocks Blocks from parseConsent().
 * @returns The consent text.
 */
export function ConsentText({ blocks }: { blocks: ConsentBlock[] }) {
  return (
    <div className="space-y-4 text-base leading-relaxed">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "h1":
            return (
              <h1 key={i} className="text-2xl font-bold tracking-tight">
                {block.text}
              </h1>
            );
          case "h2":
            return (
              <h2 key={i} className="pt-2 text-lg font-semibold">
                {block.text}
              </h2>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-6">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          default:
            return <p key={i}>{block.text}</p>;
        }
      })}
    </div>
  );
}
