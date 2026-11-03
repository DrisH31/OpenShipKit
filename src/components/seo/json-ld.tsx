//
// <JsonLd data={…} /> — structured data as a plain <script type="application/ld+json">
// in the server-rendered HTML (not next/script: crawlers that don't run JS must
// see it). `<`, `>` and `&` are escaped so content can never close the tag.
// Works in server and client trees; it renders no interactive UI.
//

import { serializeJsonLd, type JsonLdObject } from "@/shared/jsonld";

/** Render one JSON-LD object, or several (one script each, so a bad one can't spoil the rest). */
export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const list = Array.isArray(data) ? data : [data];
  return (
    <>
      {list.map((item, i) => (
        <script
          key={i}
          type="application/ld+json"
          // Serialised and escaped by serializeJsonLd; never pass unescaped strings here.
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }}
        />
      ))}
    </>
  );
}
