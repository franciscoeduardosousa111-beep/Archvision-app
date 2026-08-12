import React, { useState, useEffect, useRef } from "react";
import {
  Wand2, Camera, Ruler, PenLine, History, Download, Upload,
  Loader2, AlertCircle, Sparkles, X, Trash2, Info
} from "lucide-react";
import * as THREE from "three";

const ink = "#1B1A17";
const inkSoft = "#4B4A44";
const muted = "#8B887E";
const paper = "#F6F4EF";
const surface = "#FFFFFF";
const lineC = "rgba(27,26,23,0.10)";
const blueprint = "#2F4156";
const clay = "#A9754F";
const sage = "#6E7B58";

const STYLES = ["Moderno","Contemporâneo","Industrial","Escandinavo","Minimalista","Clássico","Rústico","Luxo","Praiano","Boho"];
const BUDGETS = ["Pequeno","Médio","Alto","Luxo"];

// ---------- API helpers ----------
// Em produção, o navegador NUNCA chama a Anthropic diretamente (exporia sua
// chave de API e esbarraria em CORS). Esta função chama a sua própria função
// serverless (netlify/functions/generate.js), que guarda a chave no servidor.
async function callClaude({ system, userText, imageBase64, imageMediaType }) {
  const content = [];
  if (imageBase64) {
    content.push({ type: "image", source: { type: "base64", media_type: imageMediaType || "image/png", data: imageBase64 } });
  }
  content.push({ type: "text", text: userText });

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages: [{ role: "user", content }], max_tokens: 1400 }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error("Falha na chamada à API (" + response.status + ") " + errText.slice(0, 200));
  }
  const data = await response.json();
  const text = data.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// Normaliza qualquer imagem enviada (incluindo formatos que a API não aceita
// diretamente, como HEIC de iPhone) para JPEG e reduz o tamanho, desenhando
// num canvas — isso evita falhas silenciosas por formato ou payload grandes.
function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 1280;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler essa imagem. Tente outro formato (JPG/PNG)."));
    };
    img.src = url;
  });
}

// Fora do sandbox do artefato (site publicado de verdade), download via <a
// download> funciona normalmente — sem as restrições do iframe do Claude.ai.
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copyText(content) {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

// ---------- Small UI bits ----------
function Pills({ label, options, value, onChange, accent }) {
  return (
    <div className="mb-4">
      <p className="text-xs mb-2" style={{ color: muted, fontWeight: 600, letterSpacing: 0.5 }}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)}
            className="px-3 py-1.5 rounded-full text-xs"
            style={{
              border: `1px solid ${o === value ? accent : lineC}`,
              color: o === value ? accent : inkSoft,
              background: o === value ? accent + "14" : "transparent",
            }}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Notice({ children }) {
  return (
    <div className="rounded-lg p-3 mb-4 flex items-start gap-2" style={{ background: "#EEF1E9", border: "1px solid #D8DECB" }}>
      <Info size={14} color={sage} style={{ marginTop: 2, flexShrink: 0 }} />
      <p className="text-xs" style={{ color: "#4A5240" }}>{children}</p>
    </div>
  );
}

function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div className="rounded-lg p-3 mb-4 flex items-start gap-2" style={{ background: "#FBEAEA", border: "1px solid #E9C6C6" }}>
      <AlertCircle size={14} color="#A23B3B" style={{ marginTop: 2, flexShrink: 0 }} />
      <p className="text-xs" style={{ color: "#7A2A2A" }}>{msg}</p>
    </div>
  );
}

function GenerateButton({ onClick, disabled, loading, label }) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm"
      style={{ background: disabled ? muted : ink, color: paper, fontWeight: 500, opacity: loading ? 0.75 : 1 }}>
      {loading ? <><Loader2 size={15} className="animate-spin" /> Gerando com a API real…</> : <>{label} <Sparkles size={15} /></>}
    </button>
  );
}

// ---------- Bubble diagram (SVG) for plan/sketch modes ----------
function BubbleDiagram({ data, svgRef }) {
  const rooms = data?.comodos || [];
  const n = rooms.length || 1;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = 560 / cols, cellH = 340 / rows;
  const centers = rooms.map((_, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    return { x: col * cellW + cellW / 2 + 20, y: row * cellH + cellH / 2 + 20 };
  });
  const nameIndex = Object.fromEntries(rooms.map((r, i) => [r.nome, i]));

  return (
    <svg ref={svgRef} viewBox="0 0 600 400" className="w-full h-auto rounded-lg" style={{ background: surface, border: `1px solid ${lineC}` }}>
      {rooms.map((r, i) => (r.conexoes || []).map((c) => {
        const j = nameIndex[c];
        if (j === undefined || j <= i) return null;
        return <line key={i + "-" + j} x1={centers[i].x} y1={centers[i].y} x2={centers[j].x} y2={centers[j].y} stroke={muted} strokeWidth="1.4" strokeDasharray="4 3" />;
      }))}
      {rooms.map((r, i) => (
        <g key={r.nome + i}>
          <circle cx={centers[i].x} cy={centers[i].y} r={Math.min(cellW, cellH) / 2 - 14} fill={i === 0 ? "#E7EBEF" : paper} stroke={blueprint} strokeWidth="1.5" />
          <text x={centers[i].x} y={centers[i].y - 2} textAnchor="middle" fontSize="12" fontFamily="Inter, sans-serif" fill={ink} fontWeight="600">{r.nome}</text>
          <text x={centers[i].x} y={centers[i].y + 14} textAnchor="middle" fontSize="9" fontFamily="Inter, sans-serif" fill={muted}>{r.funcao}</text>
        </g>
      ))}
    </svg>
  );
}

// ---------- Modelo 3D volumétrico (three.js) ----------
function colorForFuncao(f) {
  if (f === "intimo") return 0xB79A8F;
  if (f === "servico") return 0xA9C0C9;
  if (f === "externo") return 0x9AB07E;
  return 0xC9A98A; // social / default
}

function hexToNum(hex, fallback = 0xC9A98A) {
  if (!hex || typeof hex !== "string") return fallback;
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return Number.isNaN(n) ? fallback : n;
}

function roomsToBlocks(comodos) {
  return (comodos || []).map((r, i) => ({
    label: r.nome,
    color: colorForFuncao(r.funcao),
    w: 3.2 + (i % 3) * 0.5,
    d: 3.2 + (i % 2) * 0.5,
    h: 2.6 + (i % 2) * 0.3,
  }));
}

// blocks: [{ label, color (número hex), w, d, h (metros aprox.) }]
function ThreeMassing({ blocks }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !blocks || !blocks.length) return;

    const width = mount.clientWidth || 560;
    const height = 300;
    const SCALE = 0.5; // metros -> unidades da cena

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF6F4EF);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(6, 6, 9);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(5, 8, 4);
    scene.add(dir);

    const group = new THREE.Group();
    scene.add(group);

    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xEDEAE1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    group.add(ground);

    const n = blocks.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellSize = 2.4;
    const offsetX = ((cols - 1) * cellSize) / 2;
    const offsetZ = ((rows - 1) * cellSize) / 2;

    blocks.forEach((b, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const w = Math.max(1.6, Math.min(b.w || 3.4, 6)) * SCALE;
      const d = Math.max(1.6, Math.min(b.d || 3.4, 6)) * SCALE;
      const h = Math.max(1.2, Math.min(b.h || 2.6, 3.6)) * SCALE;
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(col * cellSize - offsetX, h / 2, row * cellSize - offsetZ);
      group.add(mesh);

      const edges = new THREE.EdgesGeometry(geo);
      const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1B1A17, linewidth: 1 }));
      outline.position.copy(mesh.position);
      group.add(outline);
    });

    let rotY = 0.5, rotX = -0.15;
    group.rotation.y = rotY;
    group.rotation.x = 0;

    let dragging = false, lastX = 0, lastY = 0;
    const onDown = (e) => { dragging = true; const p = e.touches ? e.touches[0] : e; lastX = p.clientX; lastY = p.clientY; };
    const onMove = (e) => {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - lastX, dy = p.clientY - lastY;
      lastX = p.clientX; lastY = p.clientY;
      rotY += dx * 0.01;
      rotX = Math.max(-0.6, Math.min(0.2, rotX + dy * 0.005));
      group.rotation.y = rotY;
      group.rotation.x = rotX;
    };
    const onUp = () => { dragging = false; };

    renderer.domElement.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    renderer.domElement.addEventListener("touchstart", onDown, { passive: true });
    renderer.domElement.addEventListener("touchmove", onMove, { passive: true });
    renderer.domElement.addEventListener("touchend", onUp);

    let raf;
    const animate = () => { raf = requestAnimationFrame(animate); renderer.render(scene, camera); };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      renderer.dispose();
      if (mount) mount.innerHTML = "";
    };
  }, [blocks]);

  if (!blocks || !blocks.length) return <p className="text-xs" style={{ color: muted }}>Sem dados suficientes para montar o volume 3D.</p>;
  return <div ref={mountRef} className="w-full rounded-lg overflow-hidden cursor-grab active:cursor-grabbing" style={{ border: `1px solid ${lineC}`, height: 300 }} />;
}

// =================================================================
// MODE: Descrição
// =================================================================
function ModoTexto({ onSaved }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("Moderno");
  const [budget, setBudget] = useState("Médio");
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const SYSTEM = `Você é um arquiteto e designer de interiores sênior. Responda APENAS com JSON válido, sem markdown, no formato:
{"interpretacao":"1-2 frases confirmando o briefing","conceito":"1 parágrafo com o conceito criativo","paleta":[{"nome":"cor","hex":"#RRGGBB"}, 4 a 5 itens],"materiais":["item",5 a 7 itens],"iluminacao":["item",3 itens],"memorial":"1 parágrafo em tom de memorial descritivo","volumetria":{"largura":numero_em_metros,"profundidade":numero_em_metros,"altura":numero_em_metros}}
O campo volumetria é sua estimativa aproximada das dimensões do ambiente descrito, em metros (ex.: uma sala de estar típica: largura 4.5, profundidade 4, altura 2.7).`;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setStatus("loading"); setError("");
    try {
      const data = await callClaude({ system: SYSTEM, userText: `Descrição: "${prompt}"\nEstilo: ${style}\nOrçamento: ${budget}` });
      setResult(data); setStatus("done");
      onSaved({ tipo: "Descrição", titulo: prompt.slice(0, 60), data, ts: Date.now() });
    } catch (e) { setError(e.message); setStatus("error"); }
  };

  return (
    <div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ex.: Quero uma sala integrada com cozinha americana, iluminação quente e estilo industrial."
        rows={3}
        className="w-full rounded-lg px-3.5 py-3 text-sm outline-none resize-none mb-4"
        style={{ border: `1px solid ${lineC}`, color: ink, background: paper }} />
      <Pills label="ESTILO" options={STYLES} value={style} onChange={setStyle} accent={blueprint} />
      <Pills label="ORÇAMENTO" options={BUDGETS} value={budget} onChange={setBudget} accent={clay} />
      <ErrorBox msg={error} />
      <GenerateButton onClick={handleGenerate} disabled={!prompt.trim()} loading={status === "loading"} label="Gerar projeto" />

      {status === "done" && result && (
        <div className="mt-5 space-y-4 rounded-lg p-4" style={{ background: paper, border: `1px solid ${lineC}` }}>
          <Field label="INTERPRETAÇÃO" text={result.interpretacao} />
          <Field label="CONCEITO" text={result.conceito} />
          <div>
            <p className="text-xs mb-2" style={{ color: muted, fontWeight: 600 }}>PALETA DE CORES</p>
            <div className="flex gap-2 flex-wrap">
              {result.paleta?.map((c) => (
                <div key={c.hex} className="text-center">
                  <div className="w-12 h-12 rounded-lg mb-1" style={{ background: c.hex, border: `1px solid ${lineC}` }} />
                  <p className="text-[10px]" style={{ color: muted }}>{c.nome}</p>
                </div>
              ))}
            </div>
          </div>
          <ListField label="MATERIAIS SUGERIDOS" items={result.materiais} />
          <ListField label="ILUMINAÇÃO" items={result.iluminacao} />
          <Field label="MEMORIAL DESCRITIVO" text={result.memorial} italic accentColor={clay} />
          {result.volumetria && (
            <div>
              <p className="text-xs mb-2" style={{ color: muted, fontWeight: 600 }}>MODELO 3D (volumetria aproximada)</p>
              <ThreeMassing blocks={[{
                label: "Ambiente proposto",
                color: hexToNum(result.paleta?.[0]?.hex),
                w: result.volumetria.largura, d: result.volumetria.profundidade, h: result.volumetria.altura,
              }]} />
              <p className="text-[11px] mt-1.5" style={{ color: muted }}>Arraste para girar. Dimensões estimadas pela IA — não medidas reais.</p>
            </div>
          )}
          <ExportRow name="descricao" data={result} />
        </div>
      )}
    </div>
  );
}

// =================================================================
// MODE: Foto
// =================================================================
function ModoFoto({ onSaved }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [modText, setModText] = useState("");
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const SYSTEM = `Você é um arquiteto de interiores analisando uma foto real de um ambiente. Responda APENAS com JSON válido, sem markdown:
{"observado":{"piso":"...","paredes":"...","iluminacao":"...","moveis":["..."]},"proposta":"1 parágrafo descrevendo como o ambiente ficaria após a mudança pedida","paleta":[{"nome":"cor","hex":"#RRGGBB"},4 itens],"materiais_sugeridos":["item",4 a 6 itens],"volumetria":{"largura":numero_em_metros,"profundidade":numero_em_metros,"altura":numero_em_metros}}
O campo volumetria é sua estimativa aproximada das dimensões do ambiente visto na foto, em metros.`;

  const handleFile = async (f) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleGenerate = async () => {
    if (!file || !modText.trim()) return;
    setStatus("loading"); setError("");
    try {
      const b64 = await processImageFile(file);
      const data = await callClaude({
        system: SYSTEM,
        userText: `O que o usuário deseja modificar: "${modText}". Analise a foto anexada e responda no formato pedido.`,
        imageBase64: b64,
        imageMediaType: "image/jpeg",
      });
      setResult(data); setStatus("done");
      onSaved({ tipo: "Foto", titulo: modText.slice(0, 60), data, ts: Date.now() });
    } catch (e) { setError(e.message); setStatus("error"); }
  };

  return (
    <div>
      <Notice>A IA analisa a foto real que você enviar (usando visão da Claude) e descreve como o ambiente mudaria — ela não gera uma nova imagem fotorrealista, isso exigiria uma API de geração de imagem separada.</Notice>

      {!preview ? (
        <label
          htmlFor="archvision-foto-input"
          className="w-full rounded-lg flex flex-col items-center justify-center gap-2 py-8 mb-4 cursor-pointer"
          style={{ border: `1.5px dashed ${lineC}`, background: paper }}>
          <Upload size={20} color={muted} />
          <p className="text-sm" style={{ color: inkSoft }}>Toque para escolher uma foto do ambiente</p>
          <p className="text-xs" style={{ color: muted }}>sala · cozinha · quarto · banheiro · fachada</p>
        </label>
      ) : (
        <div className="relative mb-4">
          <img src={preview} alt="Ambiente enviado" className="w-full rounded-lg max-h-64 object-cover" style={{ border: `1px solid ${lineC}` }} />
          <button onClick={() => { setFile(null); setPreview(null); setResult(null); setStatus("idle"); }}
            className="absolute top-2 right-2 p-1.5 rounded-full" style={{ background: "rgba(0,0,0,0.55)" }}>
            <X size={14} color="#fff" />
          </button>
        </div>
      )}
      <input
        id="archvision-foto-input"
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
        onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
      />

      <input value={modText} onChange={(e) => setModText(e.target.value)}
        placeholder='O que você deseja modificar? Ex.: "Trocar piso", "Adicionar ilha"'
        className="w-full rounded-lg px-3.5 py-3 text-sm outline-none mb-4"
        style={{ border: `1px solid ${lineC}`, color: ink, background: paper }} />

      <ErrorBox msg={error} />
      <GenerateButton onClick={handleGenerate} disabled={!file || !modText.trim()} loading={status === "loading"} label="Analisar e propor mudança" />

      {status === "done" && result && (
        <div className="mt-5 space-y-4 rounded-lg p-4" style={{ background: paper, border: `1px solid ${lineC}` }}>
          <div>
            <p className="text-xs mb-1" style={{ color: muted, fontWeight: 600 }}>O QUE A IA VIU NA FOTO</p>
            <p className="text-sm" style={{ color: inkSoft }}>
              Piso: {result.observado?.piso} · Paredes: {result.observado?.paredes} · Iluminação: {result.observado?.iluminacao}
            </p>
            {result.observado?.moveis?.length > 0 && <p className="text-xs mt-1" style={{ color: muted }}>Móveis identificados: {result.observado.moveis.join(", ")}</p>}
          </div>
          <Field label="PROPOSTA" text={result.proposta} accentColor={clay} />
          <div>
            <p className="text-xs mb-2" style={{ color: muted, fontWeight: 600 }}>PALETA SUGERIDA</p>
            <div className="flex gap-2 flex-wrap">
              {result.paleta?.map((c) => (
                <div key={c.hex} className="text-center">
                  <div className="w-12 h-12 rounded-lg mb-1" style={{ background: c.hex, border: `1px solid ${lineC}` }} />
                  <p className="text-[10px]" style={{ color: muted }}>{c.nome}</p>
                </div>
              ))}
            </div>
          </div>
          <ListField label="MATERIAIS SUGERIDOS" items={result.materiais_sugeridos} />
          {result.volumetria && (
            <div>
              <p className="text-xs mb-2" style={{ color: muted, fontWeight: 600 }}>MODELO 3D (volumetria aproximada)</p>
              <ThreeMassing blocks={[{
                label: "Ambiente da foto",
                color: hexToNum(result.paleta?.[0]?.hex),
                w: result.volumetria.largura, d: result.volumetria.profundidade, h: result.volumetria.altura,
              }]} />
              <p className="text-[11px] mt-1.5" style={{ color: muted }}>Arraste para girar. Dimensões estimadas pela IA a partir da foto — não medidas reais.</p>
            </div>
          )}
          <ExportRow name="foto" data={result} />
        </div>
      )}
    </div>
  );
}

// =================================================================
// MODE: Planta (upload) / Desenhar (canvas) — share the same analysis
// =================================================================
const PLAN_SYSTEM = `Você é um arquiteto lendo uma planta ou um croqui à mão. Responda APENAS com JSON válido, sem markdown:
{"resumo":"1-2 frases descrevendo o que foi identificado","comodos":[{"nome":"nome do cômodo","funcao":"social|intimo|servico|externo","conexoes":["nomes de cômodos vizinhos/conectados"]}, 3 a 8 itens],"elementos":[{"tipo":"porta|janela|escada|garagem","local":"descrição textual da posição"}],"observacoes":"limitações ou ambiguidades que a IA notou na leitura"}`;

function PlanResult({ result }) {
  const svgRef = useRef(null);
  if (!result) return null;
  return (
    <div className="mt-5 space-y-4 rounded-lg p-4" style={{ background: paper, border: `1px solid ${lineC}` }}>
      <Field label="LEITURA DA IA" text={result.resumo} />
      <div>
        <p className="text-xs mb-2" style={{ color: muted, fontWeight: 600 }}>DIAGRAMA DE ADJACÊNCIAS (esquemático, fora de escala)</p>
        <BubbleDiagram data={result} svgRef={svgRef} />
      </div>
      {result.elementos?.length > 0 && (
        <div>
          <p className="text-xs mb-1" style={{ color: muted, fontWeight: 600 }}>ELEMENTOS IDENTIFICADOS</p>
          <ul className="text-sm space-y-1" style={{ color: inkSoft }}>
            {result.elementos.map((e, i) => <li key={i}>· {e.tipo} — {e.local}</li>)}
          </ul>
        </div>
      )}
      <div>
        <p className="text-xs mb-2" style={{ color: muted, fontWeight: 600 }}>MODELO 3D (massa volumétrica, simplificado)</p>
        <ThreeMassing blocks={roomsToBlocks(result.comodos)} />
        <p className="text-[11px] mt-1.5" style={{ color: muted }}>Arraste para girar. Cada bloco representa um cômodo identificado — não é um render fotorrealista.</p>
      </div>
      {result.observacoes && <Field label="OBSERVAÇÕES DA IA" text={result.observacoes} accentColor={clay} />}
      <div className="flex gap-2 flex-wrap">
        <ExportRow name="planta" data={result} />
        <SvgExportButton svgRef={svgRef} />
      </div>
    </div>
  );
}

function SvgExportButton({ svgRef }) {
  const handleClick = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const s = new XMLSerializer().serializeToString(svgEl);
    downloadFile("archvision-diagrama.svg", s, "image/svg+xml");
  };
  return (
    <button onClick={handleClick} className="text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ border: `1px solid ${lineC}`, color: inkSoft }}>
      <Download size={12} /> Baixar diagrama (.svg)
    </button>
  );
}

function ModoPlanta({ onSaved }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const handleFile = (f) => { setFile(f); setPreview(URL.createObjectURL(f)); };

  const handleGenerate = async () => {
    if (!file) return;
    setStatus("loading"); setError("");
    try {
      const b64 = await processImageFile(file);
      const data = await callClaude({
        system: PLAN_SYSTEM,
        userText: "Leia a planta ou croqui anexado e responda no formato pedido.",
        imageBase64: b64,
        imageMediaType: "image/jpeg",
      });
      setResult(data); setStatus("done");
      onSaved({ tipo: "Planta", titulo: data.resumo?.slice(0, 60) || "Planta enviada", data, ts: Date.now() });
    } catch (e) { setError(e.message); setStatus("error"); }
  };

  return (
    <div>
      <Notice>A IA lê a planta/croqui enviado e devolve um diagrama esquemático de cômodos e conexões — não uma planta técnica em escala real nem um arquivo CAD. Para isso é preciso reconstrução vetorial dedicada (ver plano técnico).</Notice>
      {!preview ? (
        <label
          htmlFor="archvision-planta-input"
          className="w-full rounded-lg flex flex-col items-center justify-center gap-2 py-8 mb-4 cursor-pointer"
          style={{ border: `1.5px dashed ${lineC}`, background: paper }}>
          <Upload size={20} color={muted} />
          <p className="text-sm" style={{ color: inkSoft }}>Toque para escolher sua planta (imagem, PNG, JPG ou croqui à mão)</p>
        </label>
      ) : (
        <div className="relative mb-4">
          <img src={preview} alt="Planta enviada" className="w-full rounded-lg max-h-64 object-contain" style={{ border: `1px solid ${lineC}`, background: surface }} />
          <button onClick={() => { setFile(null); setPreview(null); setResult(null); setStatus("idle"); }}
            className="absolute top-2 right-2 p-1.5 rounded-full" style={{ background: "rgba(0,0,0,0.55)" }}>
            <X size={14} color="#fff" />
          </button>
        </div>
      )}
      <input
        id="archvision-planta-input"
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
        onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
      />
      <ErrorBox msg={error} />
      <GenerateButton onClick={handleGenerate} disabled={!file} loading={status === "loading"} label="Detectar cômodos automaticamente" />
      {status === "done" && <PlanResult result={result} />}
    </div>
  );
}

// =================================================================
// MODE: Desenhar (canvas)
// =================================================================
function ModoDesenhar({ onSaved }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [hasDrawing, setHasDrawing] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
  }, []);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * (canvasRef.current.width / rect.width), y: (clientY - rect.top) * (canvasRef.current.height / rect.height) };
  };

  const start = (e) => { drawing.current = true; const { x, y } = pos(e); const ctx = canvasRef.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(x, y); setHasDrawing(true); };
  const move = (e) => { if (!drawing.current) return; const { x, y } = pos(e); const ctx = canvasRef.current.getContext("2d"); ctx.lineTo(x, y); ctx.stroke(); };
  const end = () => { drawing.current = false; };

  const clearCanvas = () => {
    const c = canvasRef.current; const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, c.width, c.height);
    setHasDrawing(false); setResult(null); setStatus("idle");
  };

  const handleGenerate = async () => {
    setStatus("loading"); setError("");
    try {
      const dataUrl = canvasRef.current.toDataURL("image/png");
      const b64 = dataUrl.split(",")[1];
      const data = await callClaude({
        system: PLAN_SYSTEM,
        userText: "Este é um croqui desenhado à mão pelo usuário (linhas simples representando paredes/cômodos). Interprete e responda no formato pedido.",
        imageBase64: b64,
        imageMediaType: "image/png",
      });
      setResult(data); setStatus("done");
      onSaved({ tipo: "Desenho", titulo: data.resumo?.slice(0, 60) || "Croqui desenhado", data, ts: Date.now() });
    } catch (e) { setError(e.message); setStatus("error"); }
  };

  return (
    <div>
      <Notice>Desenhe linhas simples representando paredes e cômodos. Ao gerar, a IA interpreta o desenho pela visão da Claude e devolve o mesmo diagrama esquemático do modo Planta.</Notice>
      <div className="rounded-lg overflow-hidden mb-3" style={{ border: `1px solid ${lineC}` }}>
        <canvas
          ref={canvasRef} width={560} height={320}
          className="w-full touch-none cursor-crosshair"
          style={{ display: "block" }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
      </div>
      <div className="flex gap-2 mb-4">
        <button onClick={clearCanvas} className="text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ border: `1px solid ${lineC}`, color: inkSoft }}>
          <Trash2 size={12} /> Limpar
        </button>
      </div>
      <ErrorBox msg={error} />
      <GenerateButton onClick={handleGenerate} disabled={!hasDrawing} loading={status === "loading"} label="Interpretar desenho" />
      {status === "done" && <PlanResult result={result} />}
    </div>
  );
}

// ---------- shared small pieces ----------
function Field({ label, text, italic, accentColor }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-xs mb-1" style={{ color: accentColor || muted, fontWeight: 600 }}>{label}</p>
      <p className="text-sm" style={{ color: inkSoft, fontStyle: italic ? "italic" : "normal" }}>{text}</p>
    </div>
  );
}
function ListField({ label, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-xs mb-1" style={{ color: muted, fontWeight: 600 }}>{label}</p>
      <ul className="text-sm space-y-1" style={{ color: inkSoft }}>
        {items.map((m, i) => <li key={i}>· {m}</li>)}
      </ul>
    </div>
  );
}
function ExportRow({ name, data }) {
  const [msg, setMsg] = useState("");
  const json = JSON.stringify(data, null, 2);

  const handleDownload = () => {
    downloadFile(`archvision-${name}.json`, json, "application/json");
  };
  const handleCopy = async () => {
    const ok = await copyText(json);
    setMsg(ok ? "Copiado para a área de transferência." : "Não deu para copiar automaticamente.");
  };

  return (
    <div>
      <div className="flex gap-2 flex-wrap pt-1">
        <button onClick={handleDownload}
          className="text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ border: `1px solid ${lineC}`, color: inkSoft }}>
          <Download size={12} /> Baixar dados (.json)
        </button>
        <button onClick={handleCopy}
          className="text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ border: `1px solid ${lineC}`, color: inkSoft }}>
          Copiar dados
        </button>
      </div>
      {msg && <p className="text-[11px] mt-1.5" style={{ color: muted }}>{msg}</p>}
    </div>
  );
}

// =================================================================
// Histórico (persistente entre sessões via localStorage do navegador)
// =================================================================
function Historico({ items, loading, onDelete }) {
  if (loading) return <p className="text-sm" style={{ color: muted }}>Carregando histórico…</p>;
  if (!items.length) return <p className="text-sm" style={{ color: muted }}>Nenhum projeto salvo ainda. Gere algo nas outras abas — fica guardado aqui automaticamente.</p>;
  return (
    <div className="space-y-2">
      {items.slice().reverse().map((it) => (
        <div key={it.ts} className="rounded-lg p-3 flex items-start justify-between gap-3" style={{ background: paper, border: `1px solid ${lineC}` }}>
          <div>
            <p className="text-xs" style={{ color: clay, fontWeight: 600 }}>{it.tipo.toUpperCase()}</p>
            <p className="text-sm" style={{ color: ink }}>{it.titulo}</p>
            <p className="text-[11px]" style={{ color: muted }}>{new Date(it.ts).toLocaleString("pt-BR")}</p>
          </div>
          <button onClick={() => onDelete(it.ts)} className="p-1.5 rounded-full hover:bg-black/5">
            <Trash2 size={14} color={muted} />
          </button>
        </div>
      ))}
    </div>
  );
}

// =================================================================
// App
// =================================================================
const TABS = [
  { key: "texto", label: "Descrição", icon: Wand2 },
  { key: "foto", label: "Foto", icon: Camera },
  { key: "planta", label: "Planta", icon: Ruler },
  { key: "desenhar", label: "Desenhar", icon: PenLine },
  { key: "historico", label: "Histórico", icon: History },
];

export default function ArchVisionCompleto() {
  const [tab, setTab] = useState("texto");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem("archvision_projetos");
      setHistory(v ? JSON.parse(v) : []);
    } catch { setHistory([]); }
    setHistoryLoading(false);
  }, []);

  const saveProject = (item) => {
    setHistory((prev) => {
      const next = [...prev, item];
      try { localStorage.setItem("archvision_projetos", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const deleteProject = (ts) => {
    setHistory((prev) => {
      const next = prev.filter((p) => p.ts !== ts);
      try { localStorage.setItem("archvision_projetos", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return (
    <div className="min-h-screen w-full" style={{ background: paper, fontFamily: "Inter, sans-serif" }}>
      <div className="max-w-2xl mx-auto px-5 py-8">
        <p className="text-xs mb-1" style={{ color: clay, fontWeight: 600, letterSpacing: 1 }}>ARCHVISION AI</p>
        <h1 className="mb-1" style={{ fontSize: 26, color: ink, fontWeight: 600 }}>Todos os fluxos, funcionando de verdade</h1>
        <p className="text-sm mb-5" style={{ color: muted }}>
          Cada aba chama a API real da Claude (texto e visão). O que a IA não consegue fazer sozinha aqui — imagem
          fotorrealista, planta em escala exata, exportação DWG/IFC — fica sinalizado em cada tela.
        </p>

        <div className="flex gap-1 mb-5 flex-wrap">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
              style={{
                background: tab === key ? ink : surface,
                color: tab === key ? paper : inkSoft,
                border: `1px solid ${tab === key ? ink : lineC}`,
              }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        <div className="rounded-xl p-5" style={{ background: surface, border: `1px solid ${lineC}` }}>
          {tab === "texto" && <ModoTexto onSaved={saveProject} />}
          {tab === "foto" && <ModoFoto onSaved={saveProject} />}
          {tab === "planta" && <ModoPlanta onSaved={saveProject} />}
          {tab === "desenhar" && <ModoDesenhar onSaved={saveProject} />}
          {tab === "historico" && <Historico items={history} loading={historyLoading} onDelete={deleteProject} />}
        </div>
      </div>
    </div>
  );
}
