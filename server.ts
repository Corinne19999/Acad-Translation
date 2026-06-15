/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
// @ts-ignore
import { translate as bingTranslate } from 'bing-translate-api';
// @ts-ignore
import baiduTranslate from 'baidu-translate-api';
import crypto from 'crypto';

// Load environmental variables
dotenv.config();

const app = express();
const PORT = 3000;

// Set up large limits for base64 transfers of manuscript pages
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

// Shared Client Utility for Gemini on server
// Set User-Agent as instructed by the gemini-api skill rules
const apiKey = process.env.GEMINI_API_KEY;
let aiClient: GoogleGenAI | null = null;

if (apiKey) {
  aiClient = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Lazy initializer wrapper to throw distinct, user-readable errors
function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const freshKey = process.env.GEMINI_API_KEY;
    if (!freshKey) {
      throw new Error('GEMINI_API_KEY 环境变量缺失。请先在 "Settings > Secrets" 中配置您的 API 密钥。');
    }
    aiClient = new GoogleGenAI({
      apiKey: freshKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// ----------------------------------------------------
// API ENDPOINTS
// ----------------------------------------------------

// Helper to format custom endpoints to standard OpenAI chat/completions URLs
function getFormattedEndpoint(endpoint: string): string {
  let cleaned = endpoint ? endpoint.trim() : '';
  if (!cleaned) return '';
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = 'https://' + cleaned;
  }
  
  // Remove all trailing slashes
  cleaned = cleaned.replace(/\/+$/, '');
  
  // If it already has chat/completions or completions, use it as is
  if (cleaned.includes('/chat/completions') || cleaned.includes('/completions')) {
    return cleaned;
  }
  
  // Zhipu Open Bigmodel API v4
  if (cleaned.endsWith('/v4') || cleaned.toLowerCase().includes('open.bigmodel.cn/api/paas/v4')) {
    return cleaned + '/chat/completions';
  }
  
  // If it ends with version notation like /v1, /v2, /v3, /v4
  if (/\/v\d+$/i.test(cleaned)) {
    return cleaned + '/chat/completions';
  }
  
  // Otherwise, default to standard OpenAI structure
  return cleaned + '/v1/chat/completions';
}

/**
 * Step 1: Visual Understanding (Layout OCR) Endpoint
 */
// Helper to map language code to English description for prompts
function getLanguageName(code: string): string {
  const mapping: { [key: string]: string } = {
    'auto': 'Auto-detected',
    'ja': 'Japanese',
    'en': 'English',
    'zh': 'Simplified Chinese',
    'ko': 'Korean',
    'de': 'German',
    'fr': 'French'
  };
  return mapping[code] || code || 'the source language';
}

function getOcrSpaceLanguage(code: string): string {
  const mapping: { [key: string]: string } = {
    'ja': 'jpn',
    'en': 'eng',
    'zh': 'chs',
    'ko': 'kor',
    'de': 'ger',
    'fr': 'fre'
  };
  const lower = code ? code.toLowerCase() : '';
  return mapping[lower] || 'eng';
}

/**
 * Step 1: Visual Understanding (Layout OCR) Endpoint
 */
app.post('/api/ocr', async (req, res) => {
  try {
    const { 
      base64Image, 
      model,
      ocrProvider,
      ocrCustomEndpoint,
      ocrCustomApiKey,
      ocrCustomModel,
      ocrSpaceApiKey,
      umiOcrEndpoint,
      sourceLanguage = 'auto'
    } = req.body;
    
    if (!base64Image) {
      return res.status(400).json({ error: '请提供有效的页面图像数据。' });
    }

    const slName = getLanguageName(sourceLanguage);
    const ocrPrompt = `You are an expert academic literature researcher and high-fidelity optical character recognition (OCR) tool.
Your task is to analyze the provided page image and perform high-quality layout-aware text recognition of the text in ${slName || 'the original document language'}:
1. Identify and extract all characters on this page accurately.
2. Maintain the natural reading structure:
   - Carefully detect multi-column structures (分欄) and read/group columns in their correct sequential reading order (from right to left for traditional vertical layouts, top to bottom; and left to right for horizontal layouts). Do not mix different columns into the same line.
   - For vertical text (縦書き), convert it into clean continuous horizontal paragraphs.
   - Filter out or omit small furigana/rubi readings if present to retain clean reading text, or format them inline cleanly.
   - Keep structural boundaries: retain clean division for titles, main paragraphs, subheadings, and notes.
3. Output the parsed text directly in Markdown format.

Do not write any introductory sentences, conversational notes, or markdown metadata. Output only the reconstructed text content.`;

    // 1b. If USING OCR.SPACE PROVIDER
    if (ocrProvider === 'ocr-space') {
      const apiKeyVal = ocrSpaceApiKey || 'helloworld';
      console.log(`[OCR Space API] Routing to https://api.ocr.space/parse/image using key: ${apiKeyVal ? '***' : 'none'}`);
      
      const langCode = getOcrSpaceLanguage(sourceLanguage);
      const params = new URLSearchParams();
      params.append('apikey', apiKeyVal);
      params.append('base64Image', base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`);
      params.append('language', langCode);
      params.append('isOverlayRequired', 'false');
      
      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
      
      if (!response.ok) {
        const errorContent = await response.text();
        throw new Error(`OCR.space API 接口调用失败 [${response.status}]: ${errorContent || response.statusText}`);
      }
      
      const data: any = await response.json();
      if (data.IsErroredOnProcessing) {
        const errDetails = data.ErrorMessage ? (Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(', ') : data.ErrorMessage) : '未知错误内容';
        throw new Error(`OCR.space 处理错误: ${errDetails}`);
      }
      
      const parsedResults = data.ParsedResults;
      let recognizedText = '';
      if (Array.isArray(parsedResults) && parsedResults[0]) {
        recognizedText = parsedResults[0].ParsedText || '';
      } else {
        throw new Error('OCR.space 返回了空的识别结果。');
      }
      
      return res.json({ recognizedText });
    }

    // 1c. If USING UMI-OCR PROVIDER
    if (ocrProvider === 'umi-ocr') {
      const rawEndpoint = umiOcrEndpoint || 'http://127.0.0.1:1224/api/ocr';
      console.log(`[Umi-OCR API] Routing to ${rawEndpoint}`);
      
      const base64Clean = base64Image.replace(/^data:image\/\w+;base64,/, '');
      const response = await fetch(rawEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          base64: base64Clean
        })
      });
      
      if (!response.ok) {
        throw new Error(`Umi-OCR 局域网服务调用失败 [${response.status}]。若您正在本地使用，请确保已启用浏览器直连模式。`);
      }
      
      const data: any = await response.json();
      if (data.code === 200 && Array.isArray(data.data)) {
        const recognizedText = data.data.map((item: any) => item.text || '').join('\n');
        return res.json({ recognizedText });
      } else if (typeof data.data === 'string') {
        throw new Error(`Umi-OCR 报错: ${data.data}`);
      } else {
        throw new Error(`Umi-OCR 接口未返回预期数据。状态码: ${data.code || '未知'}`);
      }
    }

    // 1. If USING CUSTOM PROVIDER (OpenAI-compatible)
    if (ocrProvider === 'custom') {
      const formattedUrl = getFormattedEndpoint(ocrCustomEndpoint);
      if (!formattedUrl) {
        return res.status(400).json({ error: '启用了自定义OCR提供商，但未配置有效的API端点地址。' });
      }

      console.log(`[OCR Custom API] Routing to: ${formattedUrl} using model: ${ocrCustomModel || 'unknown'}`);

      const response = await fetch(formattedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ocrCustomApiKey || ''}`
        },
        body: JSON.stringify({
          model: ocrCustomModel || 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: ocrPrompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errorContent = await response.text();
        throw new Error(`自定义OCR接口调用失败 [${response.status}]: ${errorContent || response.statusText}`);
      }

      const data: any = await response.json();
      const recognizedText = data.choices?.[0]?.message?.content || '';
      return res.json({ recognizedText });
    }

    // 2. DEFAULT GEMINI PROVIDER
    const ai = getAiClient();
    const cleanModel = model || 'gemini-3.5-flash';

    console.log(`[OCR Core] Using Gemini client model: ${cleanModel}, language: ${sourceLanguage}`);

    // Clean data-uri prefix if present
    const base64Clean = base64Image.replace(/^data:image\/\w+;base64,/, '');

    const imagePart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64Clean
      }
    };

    const promptPart = {
      text: ocrPrompt
    };

    const response = await ai.models.generateContent({
      model: cleanModel,
      contents: {
        parts: [imagePart, promptPart]
      },
      config: {
        temperature: 0.1, // low temperature for higher deterministic layout reconstruction
      }
    });

    const recognizedText = response.text || '';
    return res.json({ recognizedText });

  } catch (err: any) {
    console.error('Error in /api/ocr:', err);
    return res.status(500).json({ error: err.message || '识别过程遇到未知错误。' });
  }
});

/**
 * Step 2: Intelligent Consistent Translation Endpoint
 */
app.post('/api/translate', async (req, res) => {
  try {
    const { 
      japaneseText, 
      text,
      previousTranslation, 
      model, 
      translationProvider,
      translationCustomEndpoint,
      translationCustomApiKey,
      translationCustomModel,
      sourceLanguage = 'auto',
      targetLanguage = 'zh',
      microsoftApiKey,
      microsoftRegion,
      baiduAppId,
      baiduApiKey
    } = req.body;

    const textToTranslate = japaneseText || text;

    if (!textToTranslate) {
      return res.status(400).json({ error: '未检测到当前的待翻译原文文本，请先完成第一步识别。' });
    }

    // Language mapping helper for various external providers
    const getProviderLanguageCode = (code: string, provider: string): string => {
      const codeLower = code ? code.toLowerCase() : '';
      
      if (provider.startsWith('baidu')) {
        if (codeLower === 'ja' || codeLower === 'jp') return 'jp';
        if (codeLower === 'zh' || codeLower === 'zh-cn') return 'zh';
        if (codeLower === 'en') return 'en';
        if (codeLower === 'ko' || codeLower === 'kor') return 'kor';
        if (codeLower === 'de') return 'de';
        if (codeLower === 'fr' || codeLower === 'fra') return 'fra';
        return 'auto';
      }
      
      if (provider.startsWith('microsoft') || provider === 'bing-free') {
        if (codeLower === 'zh' || codeLower === 'zh-cn') return 'zh-Hans';
        if (codeLower === 'ja' || codeLower === 'jp') return 'ja';
        if (codeLower === 'en') return 'en';
        if (codeLower === 'ko') return 'ko';
        if (codeLower === 'de') return 'de';
        if (codeLower === 'fr') return 'fr';
        return codeLower === 'auto' ? 'auto' : codeLower;
      }
      
      if (codeLower === 'zh' || codeLower === 'zh-cn') return 'zh-CN';
      return codeLower || 'auto';
    };

    // A. GOOGLE FREE TRANSLATE SERVICE
    if (translationProvider === 'google-free') {
      console.log(`[Translation Google-Free] Source: ${sourceLanguage}, Target: ${targetLanguage}`);
      const sl = sourceLanguage === 'auto' ? 'auto' : sourceLanguage;
      const tl = targetLanguage === 'zh' ? 'zh-CN' : targetLanguage;
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Google 翻译接口调用失败 [${response.status}]`);
      }
      const data: any = await response.json();
      if (Array.isArray(data) && data[0]) {
        const translatedText = data[0].map((item: any) => item[0] || '').join('');
        return res.json({ translatedText });
      }
      throw new Error('Google 翻译接口未返回预期的数据结构。');
    }

    // B. MICROSOFT BING FREE TRANSLATE SERVICE
    if (translationProvider === 'microsoft-free') {
      console.log(`[Translation Microsoft-Free] Source: ${sourceLanguage}, Target: ${targetLanguage}`);
      const sl = getProviderLanguageCode(sourceLanguage, 'microsoft');
      const tl = getProviderLanguageCode(targetLanguage, 'microsoft');
      const slMapped = sl === 'auto' ? null : sl;
      
      const result = await bingTranslate(textToTranslate, slMapped, tl === 'auto' ? 'zh-Hans' : tl);
      const translatedText = result.translation || '';
      return res.json({ translatedText });
    }

    // C. MICROSOFT AZURE OFFICIAL TRANSLATE SERVICE
    if (translationProvider === 'microsoft-official') {
      console.log(`[Translation Microsoft-Official] Source: ${sourceLanguage}, Target: ${targetLanguage}`);
      if (!microsoftApiKey) {
        return res.status(400).json({ error: '已启用微软 Azure 翻译官方通道，但未配置 API 密钥 (Subscription Key)' });
      }
      
      const sl = getProviderLanguageCode(sourceLanguage, 'microsoft');
      const tl = getProviderLanguageCode(targetLanguage, 'microsoft');
      const slParam = sl === 'auto' ? '' : `&from=${sl}`;
      const tlParam = tl === 'auto' ? 'zh-Hans' : tl;
      const region = microsoftRegion ? microsoftRegion.trim() : '';
      
      const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0${slParam}&to=${tlParam}`;
      const headers: { [key: string]: string } = {
        'Ocp-Apim-Subscription-Key': microsoftApiKey,
        'Content-Type': 'application/json'
      };
      if (region) {
        headers['Ocp-Apim-Subscription-Region'] = region;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify([{ text: textToTranslate }])
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`微软 Azure 官方翻译接口调用失败 [${response.status}]: ${errorText}`);
      }
      
      const data: any = await response.json();
      if (Array.isArray(data) && data[0]?.translations?.[0]) {
        const translatedText = data[0].translations[0].text;
        return res.json({ translatedText });
      }
      throw new Error('微软 Azure 官方翻译接口未返回预期的数据结构。');
    }

    // D. BAIDU FREE KEYLESS TRANSLATE SERVICE
    if (translationProvider === 'baidu-free') {
      console.log(`[Translation Baidu-Free] Source: ${sourceLanguage}, Target: ${targetLanguage}`);
      const sl = getProviderLanguageCode(sourceLanguage, 'baidu');
      const tl = getProviderLanguageCode(targetLanguage, 'baidu');
      const slParam = sl === 'auto' ? 'auto' : sl;
      const tlParam = tl === 'auto' || tl === 'jp' ? 'zh' : tl;
      
      const result: any = await baiduTranslate(textToTranslate, {
        from: slParam,
        to: tlParam
      });
      
      let translatedText = '';
      if (result.trans_result && Array.isArray(result.trans_result)) {
        translatedText = result.trans_result.map((item: any) => item.dst || '').join('\n');
      } else if (result.trans_result && typeof result.trans_result === 'object') {
        const singleDst = (result.trans_result as any).dst;
        translatedText = singleDst || result.text || '';
      } else {
        translatedText = result.text || '';
      }
      return res.json({ translatedText });
    }

    // E. BAIDU OFFICIAL TRANSLATE SERVICE
    if (translationProvider === 'baidu-official') {
      console.log(`[Translation Baidu-Official] Source: ${sourceLanguage}, Target: ${targetLanguage}`);
      if (!baiduAppId || !baiduApiKey) {
        return res.status(400).json({ error: '已启用百度翻译官方通道，但未完整配置 App ID 或密钥 (Key)。' });
      }
      
      const sl = getProviderLanguageCode(sourceLanguage, 'baidu');
      const tl = getProviderLanguageCode(targetLanguage, 'baidu');
      const slParam = sl === 'auto' ? 'auto' : sl;
      const tlParam = tl === 'auto' ? 'zh' : tl;
      
      const salt = Date.now().toString();
      const rawSign = baiduAppId + textToTranslate + salt + baiduApiKey;
      const sign = crypto.createHash('md5').update(rawSign, 'utf8').digest('hex');
      
      const params = new URLSearchParams();
      params.append('q', textToTranslate);
      params.append('from', slParam);
      params.append('to', tlParam);
      params.append('appid', baiduAppId);
      params.append('salt', salt);
      params.append('sign', sign);
      
      const url = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`百度官方翻译接口调用失败 [${response.status}]: ${errorText}`);
      }
      
      const data: any = await response.json();
      if (data.error_code) {
        throw new Error(`百度官方翻译返回错误 [代码 ${data.error_code}]: ${data.error_msg || '未知错误'}`);
      }
      
      if (data.trans_result && Array.isArray(data.trans_result)) {
        const translatedText = data.trans_result.map((item: any) => item.dst || '').join('\n');
        return res.json({ translatedText });
      }
      throw new Error('百度官方翻译接口未返回预期的数据结构。');
    }

    // B. AI-BASED RECONSTRUCTION AND TRANSLATION (Gemini/Custom OpenAI)
    const slName = getLanguageName(sourceLanguage);
    const tlName = getLanguageName(targetLanguage);

    const systemPrompt = `You are an expert translator specializing in translating high-level scholarly publications, book chapters, and historical/literary works from ${slName || 'their original language'} into elegant, faithful ${tlName}.

Current Style Guidelines:
1. Maintain high-quality academic precision, prioritizing technical terminology accuracy and historical research appropriateness.
2. Be faithful to the original text style, structure, and expression without arbitrary deletion or decoration. Keep terms, names, and overall logic consistent.

To achieve superior translation quality, you MUST:
1. Identify and completely remove non-content marginalia: ignore book titles, chapter names, running headers, and margin page numbers.
2. Read the page holistically to ensure high cohesion. Avoid translating line-by-line mechanically. Produce a smooth, flowing paragraph structure.
3. Keep perfect consistency of terms, styles, names, and overall logic with the preceding translation context if provided.
4. Keep paragraph boundaries intact and align formatting clearly. Output directly in ${tlName} Markdown. Do NOT add notes, explanations, or conversational markers in your output.`;

    const userPrompt = `Please translate the current page from ${slName} to ${tlName}:

[CURRENT PAGE ORIGINAL TEXT]
${textToTranslate}
[/CURRENT PAGE ORIGINAL TEXT]

[PREVIOUS PAGE TRANSLATION CONTEXT FOR CONTINUITY (IF PRESENT)]
${previousTranslation || '(This is the first page of the document. No prior page translation context is available.)'}
[/PREVIOUS PAGE TRANSLATION CONTEXT FOR CONTINUITY (IF PRESENT)]

Deliver only the translated ${tlName} markdown as your final response.`;

    // 1. If USING CUSTOM PROVIDER (OpenAI-compatible)
    if (translationProvider === 'custom') {
      const formattedUrl = getFormattedEndpoint(translationCustomEndpoint);
      if (!formattedUrl) {
        return res.status(400).json({ error: '启用了自定义翻译提供商，但未配置有效的API端点地址。' });
      }

      console.log(`[Translation Custom API] Routing to: ${formattedUrl} using model: ${translationCustomModel || 'unknown'}`);

      const response = await fetch(formattedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${translationCustomApiKey || ''}`
        },
        body: JSON.stringify({
          model: translationCustomModel || 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const errorContent = await response.text();
        throw new Error(`自定义翻译接口调用失败 [${response.status}]: ${errorContent || response.statusText}`);
      }

      const data: any = await response.json();
      const translatedText = data.choices?.[0]?.message?.content || '';
      return res.json({ translatedText });
    }

    // 2. DEFAULT GEMINI PROVIDER
    const ai = getAiClient();
    const cleanModel = model || 'gemini-3.5-flash';

    console.log(`[Translation Core] Using Gemini client model: ${cleanModel}, Target Language: ${targetLanguage}`);

    const response = await ai.models.generateContent({
      model: cleanModel,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3
      }
    });

    const translatedText = response.text || '';
    return res.json({ translatedText });

  } catch (err: any) {
    console.error('Error in /api/translate:', err);
    return res.status(500).json({ error: err.message || '翻译过程发生未知错误。' });
  }
});

// ----------------------------------------------------
// FRONTEND STATIC / DEV SERVER INTEGRATION (Vite Middleware)
// ----------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Literature Translation Assistant backend listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
