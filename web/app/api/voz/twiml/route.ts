import { NextResponse } from "next/server";

import { borrarSesion, getSesion, iniciarLlamada, turnoDeVoz } from "@/lib/voz/mijo";
import { twimlDespedir, twimlPreguntar, twimlSaludar } from "@/lib/voz/twiml";

/**
 * Webhook del turno de voz. Twilio hace POST aquí cada vez que la persona habla
 * (y también al iniciar la llamada). Respondemos TwiML: hablamos y volvemos a
 * escuchar, o hablamos y colgamos.
 *
 * Requiere URL pública (ngrok / deploy): acá es Twilio quien nos llama a
 * nosotros, al revés que en la llamada de un solo sentido de lib/twilioCall.ts,
 * donde el TwiML va incrustado en el POST y no hace falta túnel.
 *
 * La estructura viene del canal de voz del proyecto anterior; el cerebro es
 * otro (lib/voz/mijo.ts). Se conservó porque estaba bien resuelta: detección de
 * contestadora, reintento sin sonar a disco rayado, y un catch que NUNCA deja
 * la llamada muda — se despide y cuelga.
 */
function baseUrlDe(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${req.headers.get("host") ?? ""}`;
}

function xml(cuerpo: string): NextResponse {
  return new NextResponse(cuerpo, { headers: { "Content-Type": "text/xml" } });
}

export async function POST(req: Request) {
  const action = `${baseUrlDe(req)}/api/voz/twiml`;
  let callSid = "";
  try {
    const form = await req.formData();
    callSid = String(form.get("CallSid") ?? "");
    /* Twilio manda `Digits` cuando la persona usó el TECLADO y `SpeechResult`
     * cuando habló. La cédula sale mucho mejor marcada que dictada, así que se
     * aceptan las dos y gana el teclado, que no tiene margen de error. */
    const digitos = String(form.get("Digits") ?? "").replace(/#/g, "").trim();
    const dicho = digitos || String(form.get("SpeechResult") ?? "").trim();
    const estado = String(form.get("AnsweredBy") ?? "");

    if (!callSid) return xml(twimlDespedir(null, "Hubo un problema con la llamada."));

    // Contestadora: colgamos sin dejarle el discurso al buzón de voz.
    if (/machine/i.test(estado)) {
      borrarSesion(callSid);
      return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    }

    // Primer POST de la llamada: todavía no hay sesión → saludo + primera pregunta.
    if (!getSesion(callSid)) {
      // `From` cuando la persona LLAMA; `To` cuando nosotros la llamamos a ella.
      const telefono = String(form.get("From") || form.get("To") || "");
      const r = await iniciarLlamada(callSid, telefono);
      return xml(twimlSaludar({ audioUrl: r.audioUrl, texto: r.texto, action, modo: r.modo }));
    }

    const r = await turnoDeVoz(callSid, dicho);
    if (r.colgar) {
      borrarSesion(callSid);
      return xml(twimlDespedir(r.audioUrl, r.texto));
    }
    return xml(twimlPreguntar({ audioUrl: r.audioUrl, texto: r.texto, action, modo: r.modo }));
  } catch (e) {
    console.error("[voz] turno falló:", e instanceof Error ? e.message : e);
    if (callSid) borrarSesion(callSid);
    return xml(twimlDespedir(
      null,
      "Se me enredó algo por acá. Vuelva a marcar en un momento, por favor. Que esté muy bien.",
    ));
  }
}
