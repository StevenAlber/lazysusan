const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Lazy Susan rollid ja mudelid
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
    model: 'google/gemini-2.0-flash-001'
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
  }
];

const LANG_INSTRUCTIONS = {
  en: 'Respond in English only.',
  ru: 'Отвечай только на русском языке.',
  et: 'Vasta ainult eesti keeles.'
};

// Küsi ühelt agendilt
async function askAgent(agent, question, lang = 'en', context = '') {
  const role = agent.role[lang] || agent.role.en;
  const langInstruction = LANG_INSTRUCTIONS[lang] || LANG_INSTRUCTIONS.en;
  
  const systemPrompt = `You are ${agent.name}. Your role: ${role}. 
${langInstruction}
Respond briefly and concretely (max 200 words). 
Focus only on your role - don't try to cover everything.`;

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

// Dirigendi süntees
async function synthesize(question, agentResponses, lang = 'en') {
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
4. Keep response compact (max 300 words)
5. Add "Confidence: X/10" rating at the end`;

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
        max_tokens: 800,
        temperature: 0.5
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    return `Synthesis error: ${error.message}`;
  }
}

// API endpoint
app.post('/api/ask', async (req, res) => {
  const { question, lang = 'en' } = req.body;
  
  if (!question) {
    return res.status(400).json({ error: 'Question missing' });
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing' });
  }

  console.log(`\n📥 Question: ${question} (${lang})\n`);

  // Phase 1: Ask all agents in parallel
  console.log('🔄 Asking agents...');
  const agentPromises = AGENTS.map(agent => askAgent(agent, question, lang));
  const agentResponses = await Promise.all(agentPromises);

  // Log responses
  agentResponses.forEach(r => {
    if (r.error) {
      console.log(`❌ ${r.agent}: ${r.error}`);
    } else {
      console.log(`✅ ${r.agent}: response received`);
    }
  });

  // Phase 2: Conductor synthesis
  console.log('🎼 Synthesizing...');
  const synthesis = await synthesize(question, agentResponses, lang);

  const result = {
    question,
    lang,
    timestamp: new Date().toISOString(),
    agents: agentResponses,
    synthesis
  };

  console.log('✨ Done\n');
  res.json(result);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎯 Lazy Susan running on port ${PORT}`);
});
