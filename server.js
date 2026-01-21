const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const AGENTS = [
  {
    id: 'architect',
    name: 'Architect',
    role: { en: 'Structures the problem, sees the system', ru: 'Структурирует проблему, видит систему', et: 'Struktureerib probleemi, näeb süsteemi' },
    model: 'anthropic/claude-sonnet-4'
  },
  {
    id: 'redteam',
    name: 'Red Team',
    role: { en: 'Finds weaknesses, criticizes, finds holes', ru: 'Ищет слабости, критикует, находит дыры', et: 'Otsib nõrkusi, kritiseerib, leiab augud' },
    model: 'openai/gpt-4o'
  },
  {
    id: 'synth',
    name: 'Synthesizer',
    role: { en: 'Connects different views, finds patterns', ru: 'Соединяет разные взгляды, находит паттерны', et: 'Ühendab erinevad vaated, leiab mustrid' },
    model: 'google/gemini-2.5-pro-preview'
  },
  {
    id: 'facts',
    name: 'Facts',
    role: { en: 'Checks facts, searches sources', ru: 'Проверяет факты, ищет источники', et: 'Kontrollib fakte, otsib allikaid' },
    model: 'perplexity/sonar-pro'
  },
  {
    id: 'style',
    name: 'Style',
    role: { en: 'Polishes language, makes readable', ru: 'Шлифует язык, делает читаемым', et: 'Viimistleb keele, teeb loetavaks' },
    model: 'anthropic/claude-sonnet-4'
  },
  {
    id: 'futurist',
    name: 'Futurist',
    role: { en: 'Long-term view, trends, 10-100 year horizon', ru: 'Долгосрочный взгляд, тренды, горизонт 10-100 лет', et: 'Pikaajaline vaade, trendid, 10-100 aasta horisont' },
    model: 'anthropic/claude-sonnet-4'
  },
  {
    id: 'devil',
    name: 'Devil\'s Advocate',
    role: { en: 'Argues the opposite position, challenges assumptions', ru: 'Аргументирует противоположную позицию, оспаривает допущения', et: 'Argumenteerib vastupidist seisukohta, vaidlustab eeldusi' },
    model: 'openai/gpt-4o'
  }
];

const LANG_INSTRUCTIONS = {
  en: 'Respond in English only.',
  ru: 'Отвечай только на русском языке.',
  et: 'Vasta ainult eesti keeles.'
};

async function askAgent(agent, question, lang, context) {
  const role = agent.role[lang] || agent.role.en;
  const langInstruction = LANG_INSTRUCTIONS[lang] || LANG_INSTRUCTIONS.en;

  const systemPrompt = `You are ${agent.name}. Your role: ${role}.
${langInstruction}
Respond briefly and concretely (max 200 words).
Focus only on your role.`;

  const userPrompt = context
    ? `Question: ${question}\n\nOther agents' responses:\n${context}`
    : question;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://lazysusan.fly.dev',
        'X-Title': 'Lazy Susan Orchestrator'
      },
      body: JSON.stringify({
        model: agent.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (data.error) {
      return { agent: agent.name, error: data.error.message };
    }

    return {
      agent: agent.name,
      role: role,
      model: agent.model,
      response: data.choices[0].message.content
    };
  } catch (error) {
    return { agent: agent.name, error: error.message };
  }
}

async function synthesize(question, agentResponses, lang) {
  const context = agentResponses
    .filter(r => !r.error)
    .map(r => `**${r.agent}** (${r.role}):\n${r.response}`)
    .join('\n\n---\n\n');

  const langInstruction = LANG_INSTRUCTIONS[lang] || LANG_INSTRUCTIONS.en;

  const systemPrompt = `You are the Conductor - the leader of the Lazy Susan orchestra.
Your task: synthesize agents' responses into one clear, actionable answer.

${langInstruction}

Rules:
1. Don't repeat agents' words - create a new whole
2. Mark if agents disagree (DISSENT)
3. Highlight consensus and main conclusions
4. Include the Futurist's long-term perspective
5. Note the Devil's Advocate's challenges
6. Keep response compact (max 400 words)
7. Add "Confidence: X/10" rating at the end`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://lazysusan.fly.dev',
        'X-Title': 'Lazy Susan Orchestrator'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Question: ${question}\n\nAgents' responses:\n\n${context}` }
        ],
        max_tokens: 1000,
        temperature: 0.5
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    return `Synthesis error: ${error.message}`;
  }
}

app.post('/api/ask', async (req, res) => {
  const { question, lang } = req.body;
  const useLang = lang || 'en';

  if (!question) {
    return res.status(400).json({ error: 'Question missing' });
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing' });
  }

  const agentPromises = AGENTS.map(agent => askAgent(agent, question, useLang, ''));
  const agentResponses = await Promise.all(agentPromises);
  const synthesis = await synthesize(question, agentResponses, useLang);

  res.json({
    question,
    lang: useLang,
    timestamp: new Date().toISOString(),
    agents: agentResponses,
    synthesis
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lazy Susan running on port ${PORT}`);
});
