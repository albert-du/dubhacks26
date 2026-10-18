import QRCode from "qrcode";
import { getLiveDumpster, dumpsterUrl } from "@/lib/dumpsters";
import { notFound, route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const d = await getLiveDumpster((await params).id);
  if (!d) throw notFound();
  const inverse = new URL(req.url).searchParams.get("theme") === "dark";
  const svg = await QRCode.toString(dumpsterUrl(d._id), {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: inverse ? { dark: "#F1EEE4", light: "#121212" } : { dark: "#121212", light: "#F1EEE4" },
  });
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
});
