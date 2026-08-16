// PENDIENTE: definir NEXT_PUBLIC_WHATSAPP_NUMBER en el entorno antes de publicar.
// Formato: indicativo + número, sin signos ni espacios (p. ej. 573001234567).
// Mientras no exista, se usa un placeholder que NO recibe mensajes.
export const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "573000000000";

// PENDIENTE: definir NEXT_PUBLIC_PHONE_NUMBER antes de publicar.
// Es la línea a la que llama quien no tiene WhatsApp, así que sin ella ese
// canal queda muerto. Formato E.164.
export const PHONE_NUMBER = process.env.NEXT_PUBLIC_PHONE_NUMBER ?? "+576010000000";

export function phoneLink() {
  return `tel:${PHONE_NUMBER}`;
}

export const WHATSAPP_MESSAGE = "Hola Mijo, mi EPS me negó algo y necesito ayuda.";

export function whatsappLink(message: string = WHATSAPP_MESSAGE) {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
