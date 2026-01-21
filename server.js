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
    role: 'Struktureerib probleemi, näeb süsteemi',
    model: 'anthropic/claude-sonnet-4'
  },
  {
    id: 'redteam', 
    name: 'Red Team',
    role: 'Otsib nõrkusi, kritiseerib, leiab augud',
    model: 'openai/gpt-4o'
  },
  {
    id: 'synth',
    name: 'Synthesizer', 
    role: 'Ühendab erinevad vaated, leiab mustrid',
    model: 'google/gemini-2.0-flash-001'
  },
  {
    id: 'facts',
    name: 'Facts',
    role: 'Kontrollib fakte, otsib allikaid',
    model: 'perplexity/sonar-pro'
  },
  {
    id: 'style',
    name: 'Style',
    role: 'Viimistleb keele, teeb loetavaks',
    model: 'anthropic/claude-sonnet-4'
  }
];

// Küsi ühelt agendilt
async function askAgent(agent, question, context = '') {
  const systemPrompt = `Sa oled ${agent.name}. Sinu roll: ${agent.role}. 
Vasta lühidalt ja konkreetselt (max 200 sõna). 
Keskendu ainult oma rollile - ära ürita kõike katta.`;

  const userPrompt = context 
    ? `Küsimus: ${question}\n\nTeiste agentide vastused:\n${context}`
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
      role: agent.role,
      model: agent.model,
      response: data.choices[0].message.content
    };
  } catch (error) {
    return { agent: agent.name, error: error.message };
  }
}

// Dirigendi süntees
async function synthesize(question, agentResponses) {
  const context = agentResponses
    .filter(r => !r.error)
    .map(r => `**${r.agent}** (${r.role}):\n${r.response}`)
    .join('\n\n---\n\n');

  const systemPrompt = `Sa oled Dirigent - Lazy Susan orkestri juht.
Sinu ülesanne: sünteesi agentide vastused üheks selgeks, toimivaks vastuseks.

Reeglid:
1. Ära korda agentide sõnu - loo uus tervik
2. Märgi kui agendid on eriarvamusel (DISSENT)
3. Too välja konsensus ja peamised järeldused
4. Hoia vastus kompaktne (max 300 sõna)
5. Lisa lõppu "Usaldus: X/10" hinnang`;

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
          { role: 'user', content: `Küsimus: ${question}\n\nAgentide vastused:\n\n${context}` }
        ],
        max_tokens: 800,
        temperature: 0.5
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    return `Sünteesi viga: ${error.message}`;
  }
}

// API endpoint
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  
  if (!question) {
    return res.status(400).json({ error: 'Küsimus puudub' });
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY puudub' });
  }

  console.log(`\n📥 Küsimus: ${question}\n`);

  // Faas 1: Küsi kõigilt agentidelt paralleelselt
  console.log('🔄 Küsin agentidelt...');
  const agentPromises = AGENTS.map(agent => askAgent(agent, question));
  const agentResponses = await Promise.all(agentPromises);

  // Logi vastused
  agentResponses.forEach(r => {
    if (r.error) {
      console.log(`❌ ${r.agent}: ${r.error}`);
    } else {
      console.log(`✅ ${r.agent}: vastus saadud`);
    }
  });

  // Faas 2: Dirigendi süntees
  console.log('🎼 Sünteesib...');
  const synthesis = await synthesize(question, agentResponses);

  const result = {
    question,
    timestamp: new Date().toISOString(),
    agents: agentResponses,
    synthesis
  };

  console.log('✨ Valmis\n');
  res.json(result);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎯 Lazy Susan töötab pordil ${PORT}`);
});
