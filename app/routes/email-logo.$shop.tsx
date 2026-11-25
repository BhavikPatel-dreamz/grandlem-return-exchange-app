import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getEmailLayout } from "../services/settings.server";

// Raster formats only: SVG can carry scripts and most email clients don't show it.
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Public image route for the logo in customer emails. Uploaded logos are stored
 * as data URLs, which Gmail and Outlook block, so emails link here instead.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const shop = params.shop || "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return new Response("Not found", { status: 404 });
  }

  const settings = await prisma.settings.findUnique({ where: { shop } });
  const logo = settings ? getEmailLayout(settings).logoUrl : "";
  const match = /^data:([a-z/+.-]+);base64,(.+)$/i.exec(logo);
  if (!match || !ALLOWED_TYPES.has(match[1].toLowerCase())) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Buffer.from(match[2], "base64"), {
    headers: {
      "Content-Type": match[1].toLowerCase(),
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
