(function(){
  // ===========================================================
  // IA ASISTENTE - MVP
  // Autor: Lucas + M365 Copilot
  // Descripción:
  //  - Inyecta panel lateral con UI
  //  - Intercepta window.fetch (requests/responses)
  //  - Envía estado a un LLM (OpenAI o Azure OpenAI)
  //  - Explica reglas, bloqueos y límites (ej. Regla 0)
  // ===========================================================

  // Evitar doble inyección
  if (window.__IA_ASISTENTE_ACTIVE__) {
    alert("IA Asistente ya está activo.");
    return;
  }
  window.__IA_ASISTENTE_ACTIVE__ = true;

  // ---------- Utilidades de almacenamiento ----------
  const LS_KEY = "iaAsistente.v1";
  const loadCfg = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
    catch { return {}; }
  };
  const saveCfg = (cfg) => localStorage.setItem(LS_KEY, JSON.stringify(cfg));

  const cfg = Object.assign({
    provider: "openai",                // 'openai' | 'azure'
    openaiModel: "gpt-4.1",
    openaiEndpoint: "https://api.openai.com/v1/chat/completions",
    azureEndpoint: "",                 // p.ej.: https://TU-RESOURCE.openai.azure.com
    azureDeployment: "",               // nombre del deployment, p.ej. 'gpt-4o'
    azureApiVersion: "2024-06-01",
    apiKey: "",
    autoAnalyze: true,
    captureReqBody: true,
    rulesText: "Regla 0 (la más prioritaria): el precio de una cuenta o subcuenta no puede quedar negativo respecto a lo que ya se haya pagado. Regla 1: Item padre o hijo pagado al 100%: no se puede modificar precio ni borrar. Regla 2: Item padre o hijo de un item con algún otro hijo ya pagado: no se puede modificar precio de item padre, no se puede borrar. Sí se puede modificar precio de hijos (solo afectando al propio hijo). Regla 3: Item o parte de item (considerando el total del item) sin ningún pago: puedo modificarlo, cambiarle precio, o borrarlo. Regla 4: Item spliteado: cuando se le cambia algo al padre, se aplica el cambio a los hijos. Y cuando se hacen cambios en un hijo se reflejan también en resto de hijos y padre (sin entrar en loops…), excepto los cambios de precio (descuento, open item), que solo se aplican a esa misma parte. Regla 5: editar header y header subcuenta: siempre se permite, pero tienen preferencia las reglas anteriores, asi que en algunos items podrian aplicarse el descuento global y en otros no (como ya se hace un poco con bebidas alcoholicas).  ",
  }, loadCfg());

  // ---------- Estado en memoria ----------
  let originalFetch = window.fetch;
  let patched = false;
  let lastRequestJSON = null;
  let lastResponseJSON = null;
  let lastEventTime = 0;

  // ===========================================================
  // UI - PANEL LATERAL
  // ===========================================================
  const $ = (sel) => panel.querySelector(sel);

  const panel = document.createElement("div");
  panel.id = "ia-asistente-panel";
  panel.style.cssText = `
    position: fixed; top: 0; right: 0; width: 380px; height: 100vh;
    background: #0f1220; color: #e8eaf6; border-left: 2px solid #3949ab;
    z-index: 2147483647; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    display: flex; flex-direction: column; box-shadow: -6px 0 20px rgba(0,0,0,.35);
  `;
  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:#1a237e;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:20px;">🧠</span>
        <h3 style="margin:0; font-size:16px;">IA Asistente</h3>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button id="btn-min" title="Minimizar" style="background:#303f9f;color:#fff;border:0;border-radius:6px;padding:6px 8px;cursor:pointer;">—</button>
        <button id="btn-close" title="Cerrar" style="background:#d32f2f;color:#fff;border:0;border-radius:6px;padding:6px 8px;cursor:pointer;">✕</button>
      </div>
    </div>

    <div style="padding:10px 14px; overflow:auto; flex:1;">
      <section style="margin-bottom:10px;">
        <label style="display:block; font-size:12px; opacity:.8;">Proveedor</label>
        <select id="provider" style="width:100%; padding:8px; border-radius:6px; border:1px solid #3949ab; background:#121536; color:#fff;">
          <option value="openai">OpenAI</option>
          <option value="azure">Azure OpenAI</option>
        </select>
      </section>

      <section id="openai-box" style="display:none; gap:8px;">
        <label style="display:block; font-size:12px; opacity:.8;">Modelo (OpenAI)</label>
        <input id="openai-model" placeholder="gpt-4.1" style="width:100%; padding:8px; border-radius:6px; border:1px solid #3949ab; background:#121536; color:#fff;" />
        <label style="display:block; font-size:12px; opacity:.8; margin-top:6px;">Endpoint</label>
        <input id="openai-endpoint" placeholder="https://api.openai.com/v1/chat/completions" style="width:100%; padding:8px; border-radius:6px; border:1px solid #3949ab; background:#121536; color:#fff;" />
      </section>

      <section id="azure-box" style="display:none; gap:8px;">
        <label style="display:block; font-size:12px; opacity:.8;">Endpoint Azure</label>
        <input id="azure-endpoint" placeholder="https://TU-RESOURCE.openai.azure.com" style="width:100%; padding:8px; border-radius:6px; border:1px solid #3949ab; background:#121536; color:#fff;" />
        <label style="display:block; font-size:12px; opacity:.8; margin-top:6px;">Deployment</label>
        <input id="azure-deployment" placeholder="nombre-del-deployment" style="width:100%; padding:8px; border-radius:6px; border:1px solid #3949ab; background:#121536; color:#fff;" />
        <label style="display:block; font-size:12px; opacity:.8; margin-top:6px;">API Version</label>
        <input id="azure-version" placeholder="2024-06-01" style="width:100%; padding:8px; border-radius:6px; border:1px solid #3949ab; background:#121536; color:#fff;" />
      </section>

      <section style="margin-top:10px;">
        <label style="display:block; font-size:12px; opacity:.8;">API Key (se guarda localmente)</label>
        <input id="api-key" placeholder="sk-..." type="password" style="width:100%; padding:8px; border-radius:6px; border:1px solid #3949ab; background:#121536; color:#fff;" />
      </section>

      <section style="margin-top:10px;">
        <label style="display:block; font-size:12px; opacity:.8;">Reglas (pega aquí tu documento)</label>
        <textarea id="rules" rows="8" style="width:100%; padding:8px; border-radius:6px; border:1px solid #3949ab; background:#0c0f2a; color:#e8eaf6; font-family:monospace;"></textarea>
      </section>

      <section style="display:flex; gap:8px; margin-top:10px;">
        <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
          <input id="auto-analyze" type="checkbox" /> Autoanalizar
        </label>
        <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
          <input id="cap-req" type="checkbox" /> Capturar body de requests
        </label>
      </section>

      <section style="display:flex; gap:8px; margin-top:10px;">
        <button id="btn-save" style="flex:1; background:#3949ab; color:#fff; border:0; border-radius:6px; padding:8px; cursor:pointer;">Guardar</button>
        <button id="btn-analyze" style="flex:1; background:#43a047; color:#fff; border:0; border-radius:6px; padding:8px; cursor:pointer;">Analizar ahora</button>
      </section>

      <section style="display:flex; gap:8px; margin-top:10px;">
        <button id="btn-clear" style="flex:1; background:#546e7a; color:#fff; border:0; border-radius:6px; padding:8px; cursor:pointer;">Limpiar</button>
        <button id="btn-restore" style="flex:1; background:#ff7043; color:#fff; border:0; border-radius:6px; padding:8px; cursor:pointer;">Restaurar fetch</button>
      </section>

      <div id="status" style="margin-top:10px; font-size:12px; opacity:.85;">
        ⏳ Esperando JSON de la aplicación…
      </div>

      <hr style="border-color:#283593; margin:10px 0;">

      <div id="preview" style="max-height:180px; overflow:auto; background:#0c0f2a; border:1px solid #3949ab; border-radius:6px; padding:8px; font-family:monospace; font-size:12px;">
        <em>Último estado capturado (request/response) aparecerá aquí…</em>
      </div>

      <div id="output" style="margin-top:10px; background:#10163a; border:1px solid #3949ab; border-radius:6px; padding:10px;">
        <strong>Diagnóstico</strong>
        <div id="out-body" style="white-space:pre-wrap; font-family:system-ui;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // ---------- UI: eventos ----------
  const syncUI = () => {
    $("#provider").value = cfg.provider;
    $("#openai-model").value = cfg.openaiModel;
    $("#openai-endpoint").value = cfg.openaiEndpoint;
    $("#azure-endpoint").value = cfg.azureEndpoint;
    $("#azure-deployment").value = cfg.azureDeployment;
    $("#azure-version").value = cfg.azureApiVersion;
    $("#api-key").value = cfg.apiKey;
    $("#rules").value = cfg.rulesText;
    $("#auto-analyze").checked = !!cfg.autoAnalyze;
    $("#cap-req").checked = !!cfg.captureReqBody;
    toggleProviderBox();
  };

  const toggleProviderBox = () => {
    $("#openai-box").style.display = cfg.provider === "openai" ? "block" : "none";
    $("#azure-box").style.display = cfg.provider === "azure" ? "block" : "none";
  };

  $("#provider").addEventListener("change", () => {
    cfg.provider = $("#provider").value;
    toggleProviderBox();
    saveCfg(cfg);
  });

  $("#btn-save").addEventListener("click", () => {
    cfg.provider = $("#provider").value;
    cfg.openaiModel = $("#openai-model").value.trim();
    cfg.openaiEndpoint = $("#openai-endpoint").value.trim();
    cfg.azureEndpoint = $("#azure-endpoint").value.trim();
    cfg.azureDeployment = $("#azure-deployment").value.trim();
    cfg.azureApiVersion = $("#azure-version").value.trim();
    cfg.apiKey = $("#api-key").value.trim();
    cfg.rulesText = $("#rules").value;
    cfg.autoAnalyze = $("#auto-analyze").checked;
    cfg.captureReqBody = $("#cap-req").checked;
    saveCfg(cfg);
    statusMsg("✅ Configuración guardada.");
  });

  $("#btn-analyze").addEventListener("click", () => {
    const state = lastResponseJSON || lastRequestJSON;
    if (!state) {
      statusMsg("⚠️ No hay estado capturado aún.");
      return;
    }
    analyze(state);
  });

  $("#btn-clear").addEventListener("click", () => {
    lastRequestJSON = null;
    lastResponseJSON = null;
    $("#preview").textContent = "Estado limpiado.";
    $("#out-body").textContent = "";
  });

  $("#btn-restore").addEventListener("click", () => {
    restoreFetch();
    statusMsg("🟠 Se restauró window.fetch. Vuelve a activar el asistente si quieres seguir capturando.");
  });

  $("#btn-close").addEventListener("click", () => {
    restoreFetch();
    panel.remove();
    window.__IA_ASISTENTE_ACTIVE__ = false;
  });

  $("#btn-min").addEventListener("click", () => {
    const body = panel.querySelector("div:nth-child(2)");
    if (body.style.display === "none") {
      body.style.display = "block";
      $("#btn-min").textContent = "—";
    } else {
      body.style.display = "none";
      $("#btn-min").textContent = "+";
    }
  });

  $("#auto-analyze").addEventListener("change", () => {
    cfg.autoAnalyze = $("#auto-analyze").checked;
    saveCfg(cfg);
  });
  $("#cap-req").addEventListener("change", () => {
    cfg.captureReqBody = $("#cap-req").checked;
    saveCfg(cfg);
  });

  const statusMsg = (msg) => $("#status").textContent = msg;

  syncUI();

  // ===========================================================
  // Interceptación de fetch
  // ===========================================================
  function patchFetch() {
    if (patched) return;
    patched = true;
    originalFetch = window.fetch;

    window.fetch = async function(...args){
      try {
        // 1) Captura del REQUEST
        try {
          const req = parseRequest(args);
          if (req && cfg.captureReqBody) {
            try {
              lastRequestJSON = JSON.parse(req.body || "null");
              showPreview("REQUEST", lastRequestJSON);
              if (cfg.autoAnalyze) maybeAnalyze(lastRequestJSON);
            } catch {}
          }
        } catch {}

        // 2) Llamada real
        const resp = await originalFetch.apply(this, args);

        // 3) Captura del RESPONSE (si es JSON)
        try {
          const clone = resp.clone();
          const contentType = (clone.headers && clone.headers.get("content-type")) || "";
          if (/application\/json/i.test(contentType)) {
            const data = await clone.json();
            lastResponseJSON = data;
            showPreview("RESPONSE", data);
            if (cfg.autoAnalyze) maybeAnalyze(data);
          }
        } catch {}

        return resp;
      } catch (err) {
        console.warn("[IA Asistente] Error interceptando fetch:", err);
        return originalFetch.apply(this, args);
      }
    };

    statusMsg("🟢 Capturando peticiones/respuestas… Interactúa con la app para ver datos.");
  }

  function restoreFetch(){
    if (patched) {
      window.fetch = originalFetch;
      patched = false;
    }
  }

  function parseRequest(args){
    // args[0] puede ser string o Request, args[1] init
    let url = "", method = "GET", headers = {}, body = null;
    try {
      if (typeof args[0] === "string") url = args[0];
      else if (args[0] && args[0].url) url = args[0].url;

      let init = args[1] || {};
      method = (init.method || "GET").toUpperCase();
      headers = init.headers || {};
      body = init.body || null;
      if (body && typeof body !== "string") {
        // Si es FormData/URLSearchParams/Blob, no lo tocamos
        body = null;
      }
      return { url, method, headers, body };
    } catch {
      return null;
    }
  }

  function showPreview(kind, obj){
    const maxLen = 8000; // evita volcar objetos gigantes
    const text = JSON.stringify(obj, null, 2);
    const trimmed = text.length > maxLen ? (text.slice(0, maxLen) + "\n…(truncado)…") : text;
    $("#preview").textContent = `[${kind}] ${new Date().toLocaleTimeString()} \n` + trimmed;
  }

  function maybeAnalyze(state){
    const now = Date.now();
    // Rate limit: 1 análisis / 2.5s
    if (now - lastEventTime > 2500) {
      lastEventTime = now;
      analyze(state);
    }
  }

  patchFetch();

  // ===========================================================
  // LLM: construcción del prompt y llamada
  // ===========================================================
  async function analyze(state){
    const rules = (cfg.rulesText || "").trim();
    const key = (cfg.apiKey || "").trim();
    if (!key) {
      statusMsg("🔑 Falta API Key. Pégala y guarda.");
      return;
    }
    if (!rules) {
      statusMsg("📄 Falta texto de reglas. Pégalas y guarda.");
      return;
    }

    statusMsg("🤖 Analizando con IA…");

    const baseInstruction = `
Eres un asistente experto en las reglas de split y cobro que te he pasado, para una app de gestion de las comandas en un restaurant, para que usen los camareros.
Tu tarea es explicar, con base en las reglas, el estado recibido y responder:
1) Qué acciones están bloqueadas por alguna regla.
2) Por qué (explicación natural y breve).
3) Qué acciones sí están permitidas en este contexto, como cual seria el Máximo descuento que puede aplicarse sin violar la Regla 0 (si tiene sentido).
5) Si hay propagaciones padre↔hijas, indica si son atómicas (solo afecta a la que se modifique) o parciales según reglas.
6) Si el split impide operaciones (p. ej., tras iniciar un pago), acláralo claramente.
Cuando falte información, pide los datos mínimos (importe, subcuenta, etc.) y sugiere cómo comprobarlos en sistema, pero no inventes cifras ni reglas. 
Comunica en tono claro y profesional para un camarero o supervisor.

REGLAS (texto literal del sistema):
${rules}
para cumplir las reglas, la aplicacion sigue algunas medidas, te las paso para que puedas adelantarte a ellas y saber que pasaria:
Cumplimiento regla 0: Si con algún cambio (descuento, borar item) se tuviese que quedar negativa, pues ese cambio no se debería aplicar; y deberíamos sacar un toaster de aviso que ese cambio no se puede aplicar. 
Cumplimiento regla 1: no deja borrar deslizando ni en borrado multiple, y en pestaña del item, el cambio de precio o el borrado no se aplica y salta toast. 
Cumplimiento regla 2: no deja borrar deslizando ni en borrar múltiple. En pestaña del item, si es el item padre, los cambios de precio o el borrar no se aplican y salta toast.
Cumplimiento regla 3: sin limitaciones a la hora de borrar deslizando, en borrar múltiple, ni en pestaña del item. 
Cumplimiento regla 4: lógica de que al editar/borrar el padre también se intenten modificar las hijas, y lógica de que al editar sin modificar precio y al borrar un item hijo, se intente aplicar al padre y (en consecuencia?) al resto de los hijos. Si alguno de los cambios no se puede realizar porque incumpliría alguna regla anterior (en principio seria por la regla 0), no se hace ningún cambio y salta toast (que ya estaría implementado de la regla 0)
Cumplimiento regla 5: los únicos cambios criticos posibles de los headers es que se asigne un descuento o quitar service charge (ver anexo). El header de la orden completa afecta, se aplica, en los ítems padres, no en los hijos. Al cambiar algo en los header, se intenta uno por uno aplicar los cambios requeridos (añadir descuentos a todos los ítems afectados). En los ítems en los que no se incumpla ninguna regla anterior se efectúan los cambios. Si en algún item no se puede aplicar el cambio porque incumpliría alguna regla, no se efectúa el cambio. Cuando se haya acabado de aplicar los cambios a todos los ítems afectados, si en alguno no se ha podido aplicar, salta toast avisándolo. 

ESTADO ACTUAL (JSON real o aproximado capturado del front/back):
${safeStringify(state, 2)}
`.trim();

    try {
      let text = "";
      if (cfg.provider === "openai") {
        text = await callOpenAI({
          endpoint: cfg.openaiEndpoint,
          model: cfg.openaiModel,
          apiKey: key,
          system: "Eres un experto en cobros, splits y descuentos.",
          user: baseInstruction
        });
      } else {
        text = await callAzureOpenAI({
          endpoint: cfg.azureEndpoint,
          deployment: cfg.azureDeployment,
          apiVersion: cfg.azureApiVersion,
          apiKey: key,
          system: "Eres un experto en cobros, splits y descuentos.",
          user: baseInstruction
        });
      }

      $("#out-body").textContent = text || "Sin respuesta.";
      statusMsg("✅ Análisis completado.");
    } catch (e) {
      $("#out-body").textContent = "❌ Error: " + (e?.message || e);
      statusMsg("❌ Error en la llamada a la IA (CSP/CORS/clave). Revisa consola.");
      console.error("[IA Asistente] Error LLM:", e);
    }
  }

  function safeStringify(obj, indent=2){
    try { return JSON.stringify(obj, null, indent); }
    catch { return String(obj); }
  }

  async function callOpenAI({ endpoint, model, apiKey, system, user }){
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.2
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${txt}`);
    }
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || "";
  }

  async function callAzureOpenAI({ endpoint, deployment, apiVersion, apiKey, system, user }){
    if (!endpoint || !deployment) {
      throw new Error("Configura endpoint y deployment de Azure OpenAI.");
    }
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.2
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Azure OpenAI error ${res.status}: ${txt}`);
    }
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || "";
  }

  // ===========================================================
  // Créditos y advertencias
  // ===========================================================
  console.log("%cIA Asistente","background:#1a237e;color:#fff;padding:4px 8px;border-radius:4px", "MVP cargado. Usa el panel para configurar tu API Key y reglas.");
  console.log("Nota: si la página aplica CSP estricta, podría bloquear la carga del script externo o las llamadas a la IA. En tal caso, usa Tampermonkey/Extensión.");

})();
