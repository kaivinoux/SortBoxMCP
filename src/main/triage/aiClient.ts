import type { AppSettings, SenderGroup } from "../../shared/types.js";
import {
  buildZeroConfigPrompt,
  parseImportedSortPlanJson,
  type ImportedPlanSpec,
} from "./promptExporter.js";

export async function generateSortSpecWithBuiltinAi(params: {
  settings: AppSettings;
  apiKey?: string;
  senderGroups: SenderGroup[];
  existingFolders: string[];
}): Promise<ImportedPlanSpec> {
  const { settings, apiKey } = params;
  if (settings.aiProvider === "none") {
    throw new Error("Aucun fournisseur IA intégré n'est sélectionné.");
  }

  const prompt = buildZeroConfigPrompt(
    params.senderGroups,
    params.existingFolders,
    { maxSenders: 100, onlyUnknown: true },
  );

  if (settings.aiProvider === "ollama") {
    const base = (settings.aiEndpoint || "http://127.0.0.1:11434").replace(/\/+$/, "");
    const resp = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.aiModel || "qwen2.5:7b",
        prompt,
        stream: false,
        format: "json",
      }),
    });
    if (!resp.ok) {
      throw new Error(`Erreur Ollama (${resp.status}) : ${await resp.text()}`);
    }
    const data = (await resp.json()) as { response?: string };
    return parseImportedSortPlanJson(data.response || "");
  }

  if (settings.aiProvider === "gemini") {
    if (!apiKey) {
      throw new Error("Clé API Gemini manquante dans les paramètres.");
    }
    const model = settings.aiModel || "gemini-2.5-flash";
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!resp.ok) {
      throw new Error(`Erreur Gemini API (${resp.status}) : ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return parseImportedSortPlanJson(text);
  }

  // openai_compat (OpenAI, Groq, LM Studio, OpenRouter, etc.)
  if (!apiKey && !settings.aiEndpoint.includes("127.0.0.1") && !settings.aiEndpoint.includes("localhost")) {
    throw new Error("Clé API manquante pour ce fournisseur OpenAI-compatible.");
  }
  const base = (settings.aiEndpoint || "https://api.openai.com/v1").replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.aiModel || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Erreur API OpenAI-compatible (${resp.status}) : ${await resp.text()}`);
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parseImportedSortPlanJson(data.choices?.[0]?.message?.content || "");
}
