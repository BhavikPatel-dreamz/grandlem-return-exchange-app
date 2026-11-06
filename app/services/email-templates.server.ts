import prisma from "../db.server";

export const EMAIL_EVENTS = ["received", "approved", "rejected", "payment_required"] as const;
export type EmailEvent = (typeof EMAIL_EVENTS)[number];

export async function ensureDefaultTemplates(shop: string) {
  const defaults: { event: EmailEvent; language: string; subject: string; body: string }[] = [
    { event: "received", language: "en", subject: "We received your return request ({{orderNumber}})", body: "Hi {{customerName}},\n\nWe received your return request for order {{orderNumber}}.\n\nItems:\n{{items}}\n\nWe will review and get back to you.\n" },
    { event: "received", language: "sv", subject: "Vi har mottagit din returförfrågan ({{orderNumber}})", body: "Hej {{customerName}},\n\nVi har mottagit din returförfrågan för order {{orderNumber}}.\n\nArtiklar:\n{{items}}\n\nVi återkommer.\n" },
    { event: "approved", language: "en", subject: "Your return request is approved ({{orderNumber}})", body: "Hi {{customerName}},\n\nYour return request for order {{orderNumber}} is approved.\n\nLabel: {{labelLink}}\nTracking: {{trackingLink}}\n" },
    { event: "rejected", language: "en", subject: "Your return request was rejected ({{orderNumber}})", body: "Hi {{customerName}},\n\nYour return request for order {{orderNumber}} was rejected.\nReason: {{reason}}\n" },
    { event: "payment_required", language: "en", subject: "Payment required for your exchange ({{orderNumber}})", body: "Hi {{customerName}},\n\nYour exchange for order {{orderNumber}} requires a payment of {{amount}}.\nPay here: {{paymentLink}}\n" },
  ];

  for (const d of defaults) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { shop_event_language: { shop, event: d.event, language: d.language } },
    });
    if (!existing) {
      await prisma.emailTemplate.create({ data: { shop, ...d } });
    }
  }
}

export async function listEmailTemplates(shop: string) {
  await ensureDefaultTemplates(shop);
  return prisma.emailTemplate.findMany({ where: { shop }, orderBy: [{ event: "asc" }, { language: "asc" }] });
}

export async function getEmailTemplate(shop: string, id: string) {
  return prisma.emailTemplate.findFirst({ where: { shop, id } });
}

export async function upsertEmailTemplate(shop: string, input: { id?: string; event: string; language: string; subject: string; body: string }) {
  if (input.id) {
    const existing = await prisma.emailTemplate.findFirst({ where: { shop, id: input.id } });
    if (!existing) throw new Error("Template not found");
    return prisma.emailTemplate.update({
      where: { id: input.id },
      data: { event: input.event, language: input.language, subject: input.subject, body: input.body },
    });
  }
  return prisma.emailTemplate.create({
    data: { shop, event: input.event, language: input.language, subject: input.subject, body: input.body },
  });
}

export async function deleteEmailTemplate(shop: string, id: string) {
  const existing = await prisma.emailTemplate.findFirst({ where: { shop, id } });
  if (!existing) throw new Error("Template not found");
  return prisma.emailTemplate.delete({ where: { id } });
}
