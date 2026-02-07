(function(){

/* ================================
      1. INYECTAR PANEL LATERAL
=================================== */

if (document.getElementById("ia-asistente-panel")) {
  alert("El asistente ya está activo.");
  return;
}

const panel = document.createElement("div");
panel.id = "ia-asistente-panel";
panel.style = `
  position: fixed;
  top: 0;
  right: 0;
  width: 360px;
  height: 100vh;
  background: #111;
  color: #eee;
  border-left: 2px solid #444;
  z-index: 999999999;
  padding: 16px;
  overflow-y: auto;
  font-family: Arial, sans-serif;
`;
panel.innerHTML = `
  <h2 style="margin-top:0;">🧠 IA Asistente</h2>
  <div id="ia-output">Capturando datos...</div>
`;
document.body.appendChild(panel);

/* ================================
      2. INYECTAR OVERRIDE FETCH
=================================== */

const originalFetch = window.fetch;

window.fetch = async function(...args){
  const response = await originalFetch.apply(this, args);

  try {
    const clone = response.clone();
    const data = await clone.json();

    window.postMessage({
      type: "IA_CAPTURE",
      payload: data
    }, "*");

  } catch(e) {}

  return response;
};

document.getElementById("ia-output").innerHTML = `
  🟢 Asistente activado.<br>
  Esperando JSON real de la aplicación...
`;

/* ================================
      3. ESCUCHAR JSON Y CONSULTAR A IA
=================================== */

window.addEventListener("message", async (event) => {
  if (event.data?.type !== "IA_CAPTURE") return;

  const state = event.data.payload;

  // === REGLAS (AQUÍ PEGAS TU DOCUMENTO ENTERO) ===
  const reglas = `
  Pega aquí el contenido íntegro de Reglas_Split.docx
  `;

  // === PROMPT ===
  const prompt = `
Eres un asistente experto en reglas de splits, pagos parciales,
items padre/hijo y validación de operaciones.
Debes analizar el estado JSON de la aplicación
y decir:

1) Qué acciones están bloqueadas según Regla 0,1,2,3,4,5.
2) Por qué exactamente (explicación humana).
3) Qué operaciones sí están permitidas.
4) Si hay descuentos máximos posibles, calcularlos.
5) Advertencias útiles al camarero.

Reglas del sistema:
${reglas}

Estado real de la aplicación:
${JSON.stringify(state, null, 2)}

Ahora proporciona un diagnóstico amigable.
  `;

  // === LLAMADA A OPENAI (pon tu token) ===
  const token = "PON_AQUI_TU_API_KEY";

  try {
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "Authorization":"Bearer " + token
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: "Eres un experto en reglas de cobro, pagos y splits." },
          { role: "user", content: prompt }
        ]
      })
    });

    const out = await completion.json();
    const text = out.choices?.[0]?.message?.content ?? "No hay respuesta.";

    document.getElementById("ia-output").innerHTML = `
      <pre style="white-space:pre-wrap;">${text}</pre>
    `;

  } catch(e) {
    document.getElementById("ia-output").innerHTML = `
      ❌ Error llamando a la IA:<br>${e}
    `;
  }
});

})();
