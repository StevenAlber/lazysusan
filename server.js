const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Font paths - using uploaded fonts
const FONT_REGULAR = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

const AGENTS = [
  {
    id: 'architect',
    name: 'Architect',
    role: { en: 'Structures the problem, sees the system, identifies key leverage points', ru: 'Структурирует проблему, видит систему, определяет ключевые точки воздействия', et: 'Struktureerib probleemi, näeb süsteemi, tuvastab võtmekohad' },
    model: 'anthropic/claude-opus-4'
  },
  {
    id: 'redteam',
    name: 'Red Team',
    role: { en: 'Finds weaknesses, attacks assumptions, stress-tests logic', ru: 'Ищет слабости, атакует допущения, проверяет логику на прочность', et: 'Otsib nõrkusi, ründab eeldusi, testib loogikat' },
    model: 'openai/gpt-4o'
  },
  {
    id: 'synth',
    name: 'Synthesizer',
    role: { en: 'Connects different views, finds deep patterns, builds bridges', ru: 'Соединяет разные взгляды, находит глубинные паттерны, строит мосты', et: 'Ühendab erinevad vaated, leiab sügavad mustrid, ehitab sildu' },
    model: 'anthropic/claude-opus-4'
  },
  {
    id: 'facts',
    name: 'Facts',
    role: { en: 'Checks facts in real-time, searches latest sources, verifies claims', ru: 'Проверяет факты в реальном времени, ищет последние источники, верифицирует утверждения', et: 'Kontrollib fakte reaalajas, otsib värskeid allikaid, verifitseerib väiteid' },
    model: 'perplexity/sonar-pro'
  },
  {
    id: 'style',
    name: 'Style',
    role: { en: 'Polishes language, ensures clarity, makes compelling', ru: 'Шлифует язык, обеспечивает ясность, делает убедительным', et: 'Viimistleb keele, tagab selguse, teeb veenvaks' },
    model: 'anthropic/claude-opus-4'
  },
  {
    id: 'futurist',
    name: 'Futurist',
    role: { en: 'Long-term trends, 10-100 year horizon, civilizational perspective', ru: 'Долгосрочные тренды, горизонт 10-100 лет, цивилизационная перспектива', et: 'Pikaajalised trendid, 10-100 aasta horisont, tsivilisatsiooniline perspektiiv' },
    model: 'anthropic/claude-opus-4'
  },
  {
    id: 'devil',
    name: 'Devil\'s Advocate',
    role: { en: 'Argues opposite position, challenges consensus, tests robustness', ru: 'Аргументирует противоположную позицию, оспаривает консенсус, проверяет устойчивость', et: 'Argumenteerib vastupidist, vaidlustab konsensust, testib vastupidavust' },
    model: 'openai/gpt-4o'
  }
];

const LANG_INSTRUCTIONS = {
  en: 'Respond in English only. Be precise, professional, and substantive.',
  ru: 'Отвечай только на русском языке. Будь точным, профессиональным и содержательным.',
  et: 'Vasta ainult eesti keeles. Ole täpne, professionaalne ja sisukas.'
};

async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (ext === '.pdf') {
    const data = await pdfParse(file.buffer);
    return data.text;
  } else if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  } else if (ext === '.txt' || ext === '.md') {
    return file.buffer.toString('utf-8');
  }
  
  throw new Error('Unsupported file type');
}

async function askAgent(agent, question, lang, context) {
  const role = agent.role[lang] || agent.role.en;
  const langInstruction = LANG_INSTRUCTIONS[lang] || LANG_INSTRUCTIONS.en;

  const systemPrompt = `You are ${agent.name} - an elite expert in your domain.
Your role: ${role}.
${langInstruction}
Respond with substance and depth (max 250 words).
Focus only on your specific role - provide unique value that other agents cannot.
No fluff, no generic statements. Every sentence must add insight.`;

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
        max_tokens: 600,
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

  const systemPrompt = `You are the Conductor - the master synthesizer leading an elite team of AI agents.
Your task: create a definitive, actionable synthesis from 7 expert perspectives.

${langInstruction}

Rules:
1. Synthesize - don't summarize. Create new insight from the combination.
2. Mark DISSENT clearly when agents fundamentally disagree
3. Highlight CONSENSUS on key points
4. Include the Futurist's long-term implications
5. Address the Devil's Advocate's strongest challenges
6. Be decisive - give clear conclusions, not hedged opinions
7. Maximum 500 words - every word must earn its place
8. End with "Confidence: X/10" and brief justification
9. If relevant, suggest ONE concrete next action`;

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
        model: 'anthropic/claude-opus-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Question: ${question}\n\nAgents' responses:\n\n${context}` }
        ],
        max_tokens: 1200,
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
  const { question, lang, fileContent } = req.body;
  const useLang = lang || 'en';

  if (!question) {
    return res.status(400).json({ error: 'Question missing' });
  }

  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing' });
  }

  const fullQuestion = fileContent 
    ? `${question}\n\n---\nDOCUMENT CONTENT:\n${fileContent.substring(0, 15000)}`
    : question;

  const agentPromises = AGENTS.map(agent => askAgent(agent, fullQuestion, useLang, ''));
  const agentResponses = await Promise.all(agentPromises);
  const synthesis = await synthesize(fullQuestion, agentResponses, useLang);

  res.json({
    question,
    lang: useLang,
    timestamp: new Date().toISOString(),
    agents: agentResponses,
    synthesis
  });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const text = await extractText(req.file);
    res.json({ 
      filename: req.file.originalname,
      text: text.substring(0, 20000),
      length: text.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/export-pdf', async (req, res) => {
  const { question, synthesis, agents, timestamp, lang } = req.body;
  
  try {
    const doc = new PDFDocument({ 
      margin: 50,
      bufferPages: true
    });
    
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="KRYONIS_Analysis_${Date.now()}.pdf"`);
      res.send(pdfBuffer);
    });

    // Register custom fonts
    const fontExists = fs.existsSync(FONT_REGULAR);
    const fontBoldExists = fs.existsSync(FONT_BOLD);
    
    console.log('Font regular exists:', fontExists, FONT_REGULAR);
    console.log('Font bold exists:', fontBoldExists, FONT_BOLD);
    
    if (fontExists) {
      doc.registerFont('MainFont', FONT_REGULAR);
      if (fontBoldExists) {
        doc.registerFont('MainFontBold', FONT_BOLD);
      }
      doc.font('MainFont');
    }

    const cleanText = (text) => {
      return text
        .replace(/\*\*/g, '')
        .replace(/####/g, '')
        .replace(/###/g, '')
        .replace(/##/g, '')
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/[–—]/g, '-')
        .replace(/…/g, '...');
    };

    const langTitles = {
      en: { report: 'KRYONIS Analysis Report', question: 'QUESTION', synthesis: 'CONDUCTOR\'S SYNTHESIS', agents: 'AGENT RESPONSES', generated: 'Generated by KRYONIS Lazy Susan PRO' },
      ru: { report: 'Аналитический отчёт KRYONIS', question: 'ВОПРОС', synthesis: 'СИНТЕЗ ДИРИЖЁРА', agents: 'ОТВЕТЫ АГЕНТОВ', generated: 'Сгенерировано KRYONIS Lazy Susan PRO' },
      et: { report: 'KRYONIS Analüüsiraport', question: 'KÜSIMUS', synthesis: 'DIRIGENDI SÜNTEES', agents: 'AGENTIDE VASTUSED', generated: 'Genereeritud KRYONIS Lazy Susan PRO' }
    };

    const titles = langTitles[lang] || langTitles.en;
    
    const agentCodes = {
      'Architect': 'KRYONIS-Α',
      'Red Team': 'KRYONIS-Β',
      'Synthesizer': 'KRYONIS-Γ',
      'Facts': 'KRYONIS-Δ',
      'Style': 'KRYONIS-Ε',
      'Futurist': 'KRYONIS-Ζ',
      'Devil\'s Advocate': 'KRYONIS-Η'
    };

    // Header
    if (fontBoldExists && fontExists) {
      doc.font('MainFontBold');
    }
    doc.fontSize(22).fillColor('#1B4D3E').text(titles.report, { align: 'center' });
    doc.moveDown(0.5);
    
    if (fontExists) {
      doc.font('MainFont');
    }
    doc.fontSize(10).fillColor('#666').text(new Date(timestamp).toLocaleString(), { align: 'center' });
    doc.moveDown(1);

    // Question
    if (fontBoldExists && fontExists) {
      doc.font('MainFontBold');
    }
    doc.fontSize(12).fillColor('#8B6914').text(titles.question + ':');
    
    if (fontExists) {
      doc.font('MainFont');
    }
    doc.fontSize(11).fillColor('#333').text(cleanText(question).substring(0, 500));
    doc.moveDown(1);

    // Synthesis
    if (fontBoldExists && fontExists) {
      doc.font('MainFontBold');
    }
    doc.fontSize(14).fillColor('#1B4D3E').text(titles.synthesis, { underline: true });
    doc.moveDown(0.5);
    
    if (fontExists) {
      doc.font('MainFont');
    }
    doc.fontSize(10).fillColor('#333').text(cleanText(synthesis), {
      align: 'justify',
      lineGap: 2
    });
    doc.moveDown(1);

    // Agents
    doc.addPage();
    
    if (fontBoldExists && fontExists) {
      doc.font('MainFontBold');
    }
    doc.fontSize(14).fillColor('#1B4D3E').text(titles.agents, { underline: true });
    doc.moveDown(0.5);

    for (const agent of agents) {
      if (agent.error) continue;
      
      const code = agentCodes[agent.agent] || agent.agent;
      
      if (fontBoldExists && fontExists) {
        doc.font('MainFontBold');
      }
      doc.fontSize(11).fillColor('#1B4D3E').text(`${agent.agent} (${code})`);
      
      if (fontExists) {
        doc.font('MainFont');
      }
      doc.fontSize(9).fillColor('#8B6914').text(cleanText(agent.role || ''));
      doc.fontSize(9).fillColor('#333').text(cleanText(agent.response).substring(0, 1200), {
        align: 'justify',
        lineGap: 1
      });
      doc.moveDown(0.8);
      
      if (doc.y > 700) {
        doc.addPage();
      }
    }

    // Footer
    doc.fontSize(8).fillColor('#999').text(titles.generated, 50, doc.page.height - 50);

    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  const fontExists = fs.existsSync(FONT_REGULAR);
  res.json({ 
    status: 'ok', 
    fontExists,
    fontPath: FONT_REGULAR,
    timestamp: new Date().toISOString() 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lazy Susan PRO running on port ${PORT}`);
  console.log('Font path:', FONT_REGULAR);
  console.log('Font exists:', fs.existsSync(FONT_REGULAR));
});
