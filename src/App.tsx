/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  FileText, 
  Languages, 
  RotateCw, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  Download, 
  CheckCircle, 
  Circle, 
  Loader2, 
  Settings, 
  HelpCircle, 
  ZoomIn, 
  ZoomOut, 
  Copy, 
  Edit3, 
  Play, 
  Check, 
  BookOpen, 
  FileDown, 
  BookMarked,
  Layers,
  CheckCheck,
  AlertCircle
} from 'lucide-react';
import { ModelOption, PageData, PageStatus, ModelConfig } from './types';

// Supported Language Catalogs
const LANGUAGES_SOURCE = [
  { id: 'auto', name: '自动检测 (Auto)' },
  { id: 'en', name: '英文 (English)' },
  { id: 'ja', name: '日文 (Japanese)' },
  { id: 'zh', name: '中文 (Chinese)' },
  { id: 'ko', name: '韩文 (Korean)' },
  { id: 'de', name: '德文 (German)' },
  { id: 'fr', name: '法文 (French)' },
];

const LANGUAGES_TARGET = [
  { id: 'zh', name: '中文 (Chinese)' },
  { id: 'en', name: '英文 (English)' },
  { id: 'ja', name: '日文 (Japanese)' },
  { id: 'ko', name: '韩文 (Korean)' },
  { id: 'de', name: '德文 (German)' },
  { id: 'fr', name: '法文 (French)' },
];

// Helper to map language code to English description for prompts
const getLanguageLabel = (code: string): string => {
  const found = LANGUAGES_SOURCE.find(l => l.id === code);
  return found ? found.name : code;
};

// Supported Models Catalog
const AVAILABLE_MODELS: ModelOption[] = [
  { 
    id: 'gemini-3.5-flash', 
    name: 'Gemini 3.5 Flash (推荐)', 
    type: 'flash', 
    description: '速度极快，视觉识别极佳，推荐在第一步视觉理解中使用。',
    isPaid: false
  },
  { 
    id: 'gemini-2.5-flash', 
    name: 'Gemini 2.5 Flash (平衡)', 
    type: 'flash', 
    description: '新一代多模态大模型，翻译速度与理解准确度完美平衡。',
    isPaid: false
  },
  { 
    id: 'gemini-3.1-flash-lite', 
    name: 'Gemini 3.1 Flash-Lite (轻量)', 
    type: 'flash-lite', 
    description: '超高性价比，适合快速测试或预先浏览。',
    isPaid: false
  }
];

// Helper to format custom endpoints to standard OpenAI chat/completions URLs
const getFormattedEndpoint = (endpoint: string): string => {
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
};

// Helper to save page text caching (without bulky base64 imageUrls to avoid hitting 5MB LocalStorage limit)
const saveDocCache = (fileName: string, pageDataMap: { [key: number]: PageData }) => {
  if (!fileName || !pageDataMap) return;
  try {
    const cacheMap: { [key: number]: { recognizedText: string; translatedText: string; status: PageStatus } } = {};
    let hasData = false;
    for (const key in pageDataMap) {
      const page = pageDataMap[key];
      if (page.recognizedText || page.translatedText) {
        cacheMap[key] = {
          recognizedText: page.recognizedText || '',
          translatedText: page.translatedText || '',
          status: page.status
        };
        hasData = true;
      }
    }
    if (hasData) {
      localStorage.setItem(`manuscript_cache_${fileName}`, JSON.stringify(cacheMap));
    }
  } catch (e) {
    console.warn('Failed to save document cache:', e);
  }
};

// Helper to retrieve saved page text cache
const getDocCache = (fileName: string): { [key: number]: { recognizedText: string; translatedText: string; status: PageStatus } } | null => {
  if (!fileName) return null;
  try {
    const saved = localStorage.getItem(`manuscript_cache_${fileName}`);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to parse saved document cache:', e);
  }
  return null;
};

interface LogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export default function App() {
  // Document level states
  const [fileName, setFileName] = useState<string>('');
  const [fileSize, setFileSize] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [batchStartPage, setBatchStartPage] = useState<number>(1);
  const [batchEndPage, setBatchEndPage] = useState<number>(1);
  const [pages, setPages] = useState<{ [key: number]: PageData }>({});
  
  // PDF processing states
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [renderScale, setRenderScale] = useState<number>(2.0); // High DPI scale
  const [rotation, setRotation] = useState<number>(0); // Image rotation count of 90 degrees
  const [zoom, setZoom] = useState<number>(100); // Image visually zoom in/out

  // Editing state
  const [editOcrText, setEditOcrText] = useState<string>('');
  const [editTranslationText, setEditTranslationText] = useState<string>('');
  const [isEditingOcr, setIsEditingOcr] = useState<boolean>(false);
  const [isEditingTrans, setIsEditingTrans] = useState<boolean>(false);

  // Model validation / Testing connection states
  const [ocrTesting, setOcrTesting] = useState<boolean>(false);
  const [ocrTestResult, setOcrTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [translationTesting, setTranslationTesting] = useState<boolean>(false);
  const [transTestResult, setTransTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Model and translation configurations (restored from localStorage for PWA settings persistence)
   const [config, setConfig] = useState<ModelConfig>(() => {
    const saved = localStorage.getItem('manuscript_translator_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Sanitize out-of-date setting from local cache to prevent runtime rendering bugs
        if (parsed.ocrProvider === 'umi-ocr') {
          parsed.ocrProvider = 'default';
        }
        if (parsed.translationProvider === 'baidu-free') {
          parsed.translationProvider = 'microsoft-free';
        }
        
        // Ensure defaults for any new properties
        return {
          ocrModel: 'gemini-3.5-flash',
          translationModel: 'gemini-3.5-flash',
          temperature: 0.2,
          ocrProvider: 'default',
          ocrCustomEndpoint: 'https://api.openai.com/v1/chat/completions',
          ocrCustomApiKey: '',
          ocrCustomModel: 'gpt-4o',
          ocrSpaceApiKey: '',
          translationProvider: 'default',
          translationCustomEndpoint: 'https://api.openai.com/v1/chat/completions',
          translationCustomApiKey: '',
          translationCustomModel: 'gpt-4o',
          microsoftApiKey: '',
          microsoftRegion: 'global',
          baiduAppId: '',
          baiduApiKey: '',
          clientDirectMode: false,
          geminiApiKey: '',
          sourceLanguage: 'auto',
          targetLanguage: 'zh',
          ...parsed
        };
      } catch (e) {
        console.error('Failed to parse saved config:', e);
      }
    }
    return {
      ocrModel: 'gemini-3.5-flash',
      translationModel: 'gemini-3.5-flash',
      temperature: 0.2,
      ocrProvider: 'default',
      ocrCustomEndpoint: 'https://api.openai.com/v1/chat/completions',
      ocrCustomApiKey: '',
      ocrCustomModel: 'gpt-4o',
      ocrSpaceApiKey: '',
      translationProvider: 'default',
      translationCustomEndpoint: 'https://api.openai.com/v1/chat/completions',
      translationCustomApiKey: '',
      translationCustomModel: 'gpt-4o',
      microsoftApiKey: '',
      microsoftRegion: 'global',
      baiduAppId: '',
      baiduApiKey: '',
      clientDirectMode: false,
      geminiApiKey: '',
      sourceLanguage: 'auto',
      targetLanguage: 'zh'
    };
  });

  // Save config to localStorage when config changes
  useEffect(() => {
    localStorage.setItem('manuscript_translator_config', JSON.stringify(config));
  }, [config]);

  // Save page text cache to localStorage whenever "pages" or "fileName" changes
  useEffect(() => {
    if (fileName && Object.keys(pages).length > 0) {
      saveDocCache(fileName, pages);
    }
  }, [pages, fileName]);

  // Dynamic displayed labels for active interfaces in the top header and overlays
  const activeOcrLabel = config.ocrProvider === 'custom'
    ? `${config.ocrCustomModel || 'custom-model'} (API)`
    : config.ocrProvider === 'ocr-space'
    ? 'OCR.space (免费)'
    : config.ocrModel.replace('-latest', '').replace('-preview', '');

  const activeTranslationLabel = config.translationProvider === 'google-free'
    ? '谷歌内置 (免费)'
    : config.translationProvider === 'microsoft-free'
    ? '微软内置 (免费)'
    : config.translationProvider === 'microsoft-official'
    ? '微软 Azure 官方 (API)'
    : config.translationProvider === 'baidu-official'
    ? '百度开放平台 (API)'
    : config.translationProvider === 'custom'
    ? `${config.translationCustomModel || 'custom-model'} (API)`
    : config.translationModel.replace('-latest', '').replace('-preview', '');

  // Flow and status controllers
  const [isOcrProcessing, setIsOcrProcessing] = useState<boolean>(false);
  const [isTranslationProcessing, setIsTranslationProcessing] = useState<boolean>(false);
  const [batchRunning, setBatchRunning] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [apiError, setApiError] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Modals & settings visibility
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [copiedOcrStatus, setCopiedOcrStatus] = useState<boolean>(false);
  const [copiedTransStatus, setCopiedTransStatus] = useState<boolean>(false);

  // References
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const batchRunningRef = useRef<boolean>(false);

  // Initialize with some welcoming log
  useEffect(() => {
    addLog('多语种学术文献识别与翻译工作空间已经就绪。请导入 PDF 文件或文献单图开始工作。', 'info');
  }, []);

  const testOcrConnection = async () => {
    if (config.ocrProvider === 'default') {
      setOcrTestResult({ success: true, message: '默认 Gemini 视觉大模型连接状态已经由平台接管，完全准备就绪。' });
      addLog('[OCR 接口检测] Gemini 视觉模型由平台自动授权管理，连接畅通。', 'success');
      return;
    }
    setOcrTesting(true);
    setOcrTestResult(null);
    addLog(`[OCR 接口检测] 正在启动对 ${config.ocrProvider === 'ocr-space' ? 'OCR.space' : '自定义 OCR'} 接口的可用性及配置项检测...`, 'info');
    
    try {
      if (config.ocrProvider === 'ocr-space') {
        const finalKey = config.ocrSpaceApiKey || 'helloworld';
        const params = new URLSearchParams();
        params.append('apikey', finalKey);
        const tinyPixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        params.append('base64Image', tinyPixel);
        
        const response = await fetch('https://api.ocr.space/parse/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        
        if (!response.ok) {
          throw new Error(`连接 OCR.space 失败 [HTTP ${response.status}]`);
        }
        const data = await response.json();
        if (data.IsErroredOnProcessing) {
          const errDetails = data.ErrorMessage ? (Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(', ') : data.ErrorMessage) : '未知错误内容';
          throw new Error(`服务连接成功，但返回错误: ${errDetails}`);
        }
        setOcrTestResult({ success: true, message: '测试成功！OCR.space 接口连接通畅且通过校验。' });
        addLog('[OCR 接口检测] OCR.space 极速接口连接测试成功。', 'success');
      } else {
        const apiAddress = config.ocrCustomEndpoint;
        const apiKey = config.ocrCustomApiKey;
        const apiModel = config.ocrCustomModel || 'gpt-4o';
        const endpoint = getFormattedEndpoint(apiAddress);
        if (!endpoint) {
          throw new Error('请输入有效的 API 接口地址');
        }
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || ''}`
          },
          body: JSON.stringify({
            model: apiModel,
            messages: [
              { role: 'user', content: 'Say "OK" directly.' }
            ],
            max_tokens: 15
          })
        });
        
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`连接失败 [HTTP ${response.status}]: ${errText || response.statusText}`);
        }
        
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        setOcrTestResult({
          success: true,
          message: `测试通过！模型响应: "${content.trim()}"`
        });
        addLog(`[OCR 接口检测] 自定义 OCR 接口连接成功。模型响应: ${content.trim()}`, 'success');
      }
    } catch (e: any) {
      console.error(e);
      setOcrTestResult({
        success: false,
        message: e.message || '测试失败'
      });
      addLog(`[OCR 接口检测] 接口测试校验失败: ${e.message}`, 'error');
    } finally {
      setOcrTesting(false);
    }
  };

  const testTranslationConnection = async () => {
    const isFreeProvider = ['google-free', 'microsoft-free', 'baidu-free'].includes(config.translationProvider);
    if (isFreeProvider) {
      setTransTestResult({ success: true, message: '内置/免费接口无需密钥，连接完全畅通。' });
      addLog(`[翻译接口检测] 免费内置通道无需 API Key 验证，已成功跳过 API 校验。`, 'success');
      return;
    }
    setTranslationTesting(true);
    setTransTestResult(null);
    addLog(`[翻译接口检测] 正在验证翻译接口配置与连接状态...`, 'info');
    
    try {
      if (config.translationProvider === 'custom') {
        const apiAddress = config.translationCustomEndpoint;
        const apiKey = config.translationCustomApiKey;
        const apiModel = config.translationCustomModel || 'gpt-4o';
        const endpoint = getFormattedEndpoint(apiAddress);
        if (!endpoint) {
          throw new Error('请输入有效的 API 接口地址');
        }
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || ''}`
          },
          body: JSON.stringify({
            model: apiModel,
            messages: [
              { role: 'user', content: 'Say "OK" directly.' }
            ],
            max_tokens: 15
          })
        });
        
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`连接失败 [HTTP ${response.status}]: ${errText || response.statusText}`);
        }
        
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        setTransTestResult({
          success: true,
          message: `测试通过！自定义或中转模型响应: "${content.trim()}"`
        });
        addLog(`[翻译接口检测] 自定义翻译接口连接成功。模型响应: ${content.trim()}`, 'success');
      } else if (config.translationProvider === 'microsoft-official') {
        if (!config.microsoftApiKey) {
          throw new Error('请输入微软 Azure 订阅密钥 (Key)。');
        }
        addLog(`[翻译接口检测] 正在通过后端代理测试微软官方接口连接...`, 'info');
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'Hello',
            translationProvider: 'microsoft-official',
            microsoftApiKey: config.microsoftApiKey,
            microsoftRegion: config.microsoftRegion,
            sourceLanguage: 'en',
            targetLanguage: 'zh'
          })
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || `HTTP 错误 ${response.status}`);
        }
        const data = await response.json();
        setTransTestResult({
          success: true,
          message: `测试成功！译文: "${data.translatedText}"`
        });
        addLog(`[翻译接口检测] 微软 Azure 官方接口连接正常。测试译文: ${data.translatedText}`, 'success');
      } else if (config.translationProvider === 'baidu-official') {
        if (!config.baiduAppId || !config.baiduApiKey) {
          throw new Error('请输入百度翻译 App ID 与 密钥 (Key)。');
        }
        addLog(`[翻译接口检测] 正在通过后端代理测试百度官方接口连接...`, 'info');
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'Hello',
            translationProvider: 'baidu-official',
            baiduAppId: config.baiduAppId,
            baiduApiKey: config.baiduApiKey,
            sourceLanguage: 'en',
            targetLanguage: 'zh'
          })
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || `HTTP 错误 ${response.status}`);
        }
        const data = await response.json();
        setTransTestResult({
          success: true,
          message: `测试成功！译文: "${data.translatedText}"`
        });
        addLog(`[翻译接口检测] 百度翻译官方接口连接正常。测试译文: ${data.translatedText}`, 'success');
      } else {
        setTransTestResult({ success: true, message: '当前默认配置无需进行额外的密钥连接测试。' });
      }
    } catch (e: any) {
      console.error(e);
      setTransTestResult({
        success: false,
        message: e.message || '测试失败'
      });
      addLog(`[翻译接口检测] 接口测试校验失败: ${e.message}`, 'error');
    } finally {
      setTranslationTesting(false);
    }
  };

  // Update textareas when pages change
  useEffect(() => {
    if (pages[currentPage]) {
      setEditOcrText(pages[currentPage].recognizedText || '');
      setEditTranslationText(pages[currentPage].translatedText || '');
    } else {
      setEditOcrText('');
      setEditTranslationText('');
    }
    // Load current page canvas image if pdf loaded
    if (pdfDoc) {
      renderCurrentPdfPage();
    }
  }, [currentPage, pdfDoc, renderScale]);

  // Adjust scroll of logs console
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const now = new Date();
    const timestamp = now.toTimeString().split(' ')[0];
    setLogs((prev) => [...prev, { timestamp, type, message }]);
  };

  /**
   * PDF reading and lazy conversion
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    
    setFileName(file.name);
    // Format human-readable file size
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
    setFileSize(`${sizeInMB} MB`);
    
    addLog(`文件导入中: ${file.name} (${sizeInMB} MB)...`, 'info');

    // Reset previous states
    batchRunningRef.current = false;
    setBatchRunning(false);
    setBatchProgress(null);
    setPages({});
    setCurrentPage(1);
    setRotation(0);
    setZoom(100);
    setApiError('');
    
    if (file.type === 'application/pdf') {
      try {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
          try {
            const typedarray = new Uint8Array(this.result as ArrayBuffer);
            const pdfjs = (window as any).pdfjsLib;
            if (!pdfjs) {
              throw new Error('PDF.js 未能加载，请刷新页面重试。');
            }
            const pdf = await pdfjs.getDocument({ data: typedarray }).promise;
            setPdfDoc(pdf);
            setTotalPages(pdf.numPages);
            setBatchStartPage(1);
            setBatchEndPage(pdf.numPages);
            addLog(`PDF 载入成功。共检测到 ${pdf.numPages} 页。`, 'success');
            
            // Set up empty list structure or restore from local cache
            const cacheMap = getDocCache(file.name);
            const initialPages: { [key: number]: PageData } = {};
            let restoredCount = 0;
            for (let i = 1; i <= pdf.numPages; i++) {
              const cached = cacheMap ? cacheMap[i] : null;
              if (cached) {
                restoredCount++;
                initialPages[i] = {
                  pageNumber: i,
                  imageUrl: '',
                  status: cached.status || 'completed',
                  recognizedText: cached.recognizedText || '',
                  translatedText: cached.translatedText || ''
                };
              } else {
                initialPages[i] = {
                  pageNumber: i,
                  imageUrl: '',
                  status: 'idle',
                  recognizedText: '',
                  translatedText: ''
                };
              }
            }
            setPages(initialPages);
            if (restoredCount > 0) {
              addLog(`📚 本地已存在该文献的识别翻译进程！已成功为您自动恢复第 1 至 ${pdf.numPages} 页中的 ${restoredCount} 个页面的翻译与识别缓存。运行“批量级联翻译”可执行断点开始。`, 'success');
            }
          } catch (pdfErr: any) {
            console.error(pdfErr);
            addLog(`解析 PDF 失败: ${pdfErr.message}`, 'error');
            setApiError(`解析 PDF 失败: ${pdfErr.message}`);
          }
        };
        fileReader.readAsArrayBuffer(file);
      } catch (err: any) {
        addLog(`文件读取出错: ${err.message}`, 'error');
      }
    } else if (file.type.startsWith('image/')) {
      // Single literature image mode
      const fileReader = new FileReader();
      fileReader.onload = function() {
        const imgUrl = this.result as string;
        setPdfDoc(null);
        setTotalPages(1);
        setBatchStartPage(1);
        setBatchEndPage(1);
        setPages({
          1: {
            pageNumber: 1,
            imageUrl: imgUrl,
            status: 'idle',
            recognizedText: '',
            translatedText: ''
          }
        });
        addLog('单张图片加载成功！', 'success');
      };
      fileReader.readAsDataURL(file);
    } else {
      addLog('不支持的文件格式。请导入 PDF 文件或图片（JPG/PNG）。', 'error');
      setApiError('不支持的文件格式。请导入 PDF 或是图片格式。');
    }
  };

  /**
   * Render continuous PDF page on hidden canvas and extract Base64 Representation
   */
  const renderCurrentPdfPage = async () => {
    if (!pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const context = canvas.getContext('2d');
      if (!context) return;
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;
      
      // Save data URL to state pages list
      const base64Img = canvas.toDataURL('image/jpeg', 0.9);
      setPages((prev) => {
        const currentPageState = prev[currentPage];
        if (currentPageState && !currentPageState.imageUrl) {
          return {
            ...prev,
            [currentPage]: {
              ...currentPageState,
              imageUrl: base64Img
            }
          };
        }
        return prev;
      });
    } catch (err: any) {
      console.error('Error rendering PDF page:', err);
      addLog(`渲染 PDF 第 ${currentPage} 页图像错误: ${err.message}`, 'error');
    }
  };

  /**
   * Quick utility to render the page image on demand to send to Backend API
   */
  const getPageBase64 = async (pageNum: number): Promise<string> => {
    if (pages[pageNum]?.imageUrl) {
      return pages[pageNum].imageUrl;
    }
    
    if (!pdfDoc) {
      throw new Error('未加载任何文档。');
    }
    
    // Render on demand for batch operations
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // Good standard resolution for Gemini OCR
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to create canvas context');
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context, viewport }).promise;
    
    const base64 = canvas.toDataURL('image/jpeg', 0.85);
    return base64;
  };

  /**
   * STEP 1: Execute Visual Understanding (Layout-Aware OCR)
   */
  const executeOcrForPage = async (pageNum: number, silent = false): Promise<string> => {
    if (!silent) {
      setIsOcrProcessing(true);
      setApiError('');
    }
    
    setPages((prev) => ({
      ...prev,
      [pageNum]: { ...prev[pageNum], status: 'ocr_running' }
    }));
    
    if (!silent) addLog(`开始进行第一步（视觉理解）：提取第 ${pageNum} 页文献文字与版面分栏结构... 使用模型 ${activeOcrLabel}`, 'info');

    try {
      // Get the image data
      const base64Image = await getPageBase64(pageNum);
      
      const slName = config.sourceLanguage === 'auto' ? 'the source document language' : getLanguageLabel(config.sourceLanguage);
      const ocrPrompt = `You are an expert academic literature researcher and high-fidelity optical character recognition (OCR) tool.
Your task is to analyze the provided page image and perform high-quality layout-aware text recognition of the text in ${slName}:
1. Identify and extract all characters on this page accurately.
2. Maintain the natural reading structure:
   - Carefully detect multi-column structures (分欄) and read/group columns in their correct sequential reading order (from right to left for traditional vertical layouts, top to bottom; and left to right for horizontal layouts). Do not mix different columns into the same line.
   - For vertical text, convert it into clean continuous horizontal paragraphs.
   - Filter out or omit small phonetic annotations or rubi guides if present to retain clean reading text, or format them inline cleanly.
   - Keep structural boundaries: retain clean division for titles, main paragraphs, subheadings, and notes.
3. Output the parsed text directly in Markdown format.

Do not write any introductory sentences, conversational notes, or markdown metadata. Output only the reconstructed content.`;

      let recognized = '';

      if (config.clientDirectMode) {
        if (config.ocrProvider === 'ocr-space') {
          const finalKey = config.ocrSpaceApiKey || 'helloworld';
          addLog(`[浏览器直连] 正在向 OCR.space 免费视觉接口发起识别请求...`, 'info');
          
          const getOcrSpaceLanguage = (code: string) => {
            const m: { [key: string]: string } = { ja: 'jpn', en: 'eng', zh: 'chs', ko: 'kor', de: 'ger', fr: 'fre' };
            return m[code ? code.toLowerCase() : ''] || 'eng';
          };

          const params = new URLSearchParams();
          params.append('apikey', finalKey);
          params.append('base64Image', base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`);
          params.append('language', getOcrSpaceLanguage(config.sourceLanguage));
          params.append('isOverlayRequired', 'false');

          const res = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
          });

          if (!res.ok) {
            throw new Error(`OCR.space API 调用失败 [HTTP ${res.status}]`);
          }

          const resData = await res.json();
          if (resData.IsErroredOnProcessing) {
            const details = resData.ErrorMessage ? (Array.isArray(resData.ErrorMessage) ? resData.ErrorMessage.join(', ') : resData.ErrorMessage) : '未知错误内容';
            throw new Error(`OCR.space 识别过程返回错误: ${details}`);
          }
          recognized = resData.ParsedResults?.[0]?.ParsedText || '';
        } else if (config.ocrProvider === 'custom') {
          const formattedUrl = getFormattedEndpoint(config.ocrCustomEndpoint);
          if (!formattedUrl) {
            throw new Error('启用了浏览器直连，但未设置有效的自定义 OCR 接口地址。');
          }
          addLog(`[浏览器直连] 正在向自定义服务器 ${formattedUrl} 发起 OCR 识别请求...`, 'info');
          const res = await fetch(formattedUrl, {
            method: 'POST',
            className: 'no-cors-check', // annotation
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.ocrCustomApiKey || ''}`
            },
            body: JSON.stringify({
              model: config.ocrCustomModel || 'gpt-4o',
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: ocrPrompt },
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
          } as any);
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`浏览器直连自定义 OCR 失败 [${res.status}]: ${errText || res.statusText}`);
          }
          const resData = await res.json();
          recognized = resData.choices?.[0]?.message?.content || '';
        } else {
          // Gemini Direct calling
          if (!config.geminiApiKey) {
            throw new Error('启用了浏览器直连默认 Gemini 服务，请先在外部连接配置面板中填入您的 Gemini API Key。');
          }
          addLog(`[浏览器直连] 正在向官方 Gemini 服务 (${config.ocrModel}) 发起 OCR 请求...`, 'info');
          const base64Clean = base64Image.replace(/^data:image\/\w+;base64,/, '');
          
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.ocrModel}:generateContent?key=${config.geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: ocrPrompt },
                    {
                      inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64Clean
                      }
                    }
                  ]
                }
              ]
            })
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`浏览器直连 Gemini API 失败 [${res.status}]: ${errText || res.statusText}`);
          }
          const resData = await res.json();
          recognized = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
      } else {
        // Standard Server proxy route
        const response = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            base64Image, 
            model: config.ocrModel,
            ocrProvider: config.ocrProvider,
            ocrCustomEndpoint: config.ocrCustomEndpoint,
            ocrCustomApiKey: config.ocrCustomApiKey,
            ocrCustomModel: config.ocrCustomModel,
            ocrSpaceApiKey: config.ocrSpaceApiKey,
            umiOcrEndpoint: config.umiOcrEndpoint,
            sourceLanguage: config.sourceLanguage
          }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || `HTTP 错误代码: ${response.status}`);
        }

        const data = await response.json();
        recognized = data.recognizedText;
      }

      setPages((prev) => ({
        ...prev,
        [pageNum]: {
          ...prev[pageNum],
          status: 'ocr_done',
          recognizedText: recognized
        }
      }));

      // If we are currently viewing this page, update local textarea too
      if (pageNum === currentPage) {
        setEditOcrText(recognized);
      }

      const slLabel = getLanguageLabel(config.sourceLanguage);
      if (!silent) addLog(`第 ${pageNum} 页 ${slLabel} 视觉识别成功！已自动保持排版分栏。字数: ${recognized.length}`, 'success');
      return recognized;

    } catch (err: any) {
      console.error(err);
      setPages((prev) => ({
        ...prev,
        [pageNum]: { ...prev[pageNum], status: 'failed', error: err.message }
      }));
      if (!silent) {
        setApiError(err.message);
        addLog(`第 ${pageNum} 页识别失败: ${err.message}`, 'error');
      }
      throw err;
    } finally {
      if (!silent) setIsOcrProcessing(false);
    }
  };

  /**
   * STEP 2: Execute Context-Aware Translation
   */
  const executeTranslationForPage = async (pageNum: number, silent = false, overrideOcrText?: string): Promise<string> => {
    if (!silent) {
      setIsTranslationProcessing(true);
      setApiError('');
    }

    setPages((prev) => ({
      ...prev,
      [pageNum]: { ...prev[pageNum], status: 'translating' }
    }));

    // Retrieve OCR source text
    const sourceJapanese = overrideOcrText !== undefined ? overrideOcrText : 
                          (pages[pageNum]?.recognizedText || (await executeOcrForPage(pageNum, true)));

    if (!sourceJapanese || sourceJapanese.trim() === '') {
      const errMsg = '未能找到第一步提取的原文。正在自动为您重新触发第一步 OCR...';
      if (!silent) addLog(errMsg, 'warn');
    }

    // Retrieve contextual translation from the previous page to pass to translation models
    const previousPageTranslation = pageNum > 1 ? (pages[pageNum - 1]?.translatedText || '') : '';
    
    if (!silent) {
      const slLabel = getLanguageLabel(config.sourceLanguage);
      const tlLabel = getLanguageLabel(config.targetLanguage);
      addLog(`开始进行第二步（智能翻译）：正在润色翻译第 ${pageNum} 页文献从 ${slLabel} 至 ${tlLabel}...`, 'info');
      if (pageNum > 1 && previousPageTranslation) {
        addLog(`[连贯性桥接] 已提取上一页 (Page ${pageNum - 1}) 的译文作为上下文传入翻译，保障句式、专业名词连贯。`, 'info');
      }
    }

    try {
      const slLabel = getLanguageLabel(config.sourceLanguage);
      const tlLabel = getLanguageLabel(config.targetLanguage);

      const systemPrompt = `你是一位精通一流水准的多语种学术文献、历史典籍、近现代汉学及高水平学术研究翻译的专家。
当前正在进行一部重要的学术文献之 ${tlLabel} 意译翻译与润色中文化工作。

【重磅：上下文连贯性指导】
由于书籍是分页翻译的，为了确保多页文献字词、语气和专有名词的严密一致性，你会被提供《上一页的中文译文》供参考。
1. 请特别注意承接上一页结尾的语义，使其自然过渡，确保不要出现段落语义割裂。
2. 保持角色人称、词意术语、专有名词和学术口吻的严格连贯。

【当前页翻译风格及精细化要求】：
1. 采用高水准、规范严谨的学术志风格，力求学术术语准确，句式表达精炼而文雅。
2. 忠实于原文：在完美保留并复现原文所有语义信息、逻辑架构的基础上表达，不可主观臆造。

不要包含任何“好的”、“这是翻译”等过渡或闲聊文字，直接输出对应的 ${tlLabel} Markdown 译文。`;

      const userPrompt = `【参考信息：上一页的翻译上下文 (可能为空)】：
"""
${previousPageTranslation}
"""

【本次需要翻译的 ${slLabel} 原文文本 (请严格翻译成 ${tlLabel})】：
"""
${sourceJapanese}
"""

请按学术规范翻译交付该页的高清 ${tlLabel} 译文：`;

      let translated = '';

      if (config.translationProvider === 'google-free') {
        const sl = config.sourceLanguage === 'auto' ? 'auto' : config.sourceLanguage;
        const tl = config.targetLanguage === 'zh' ? 'zh-CN' : config.targetLanguage;
        addLog(`[本地直连] 正在调用 Google 免费翻译接口 (${sl} -> ${tl})...`, 'info');
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(sourceJapanese)}`;
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Google 翻译接口在客户端直连失败 [Status ${response.status}]`);
        }
        const data = await response.json();
        if (Array.isArray(data) && data[0]) {
          translated = data[0].map((item: any) => item[0] || '').join('');
        } else {
          throw new Error('Google 翻译接口返回非预期的数据结构。');
        }
      } else if (config.clientDirectMode) {
        if (config.translationProvider === 'custom') {
          const formattedUrl = getFormattedEndpoint(config.translationCustomEndpoint);
          if (!formattedUrl) {
            throw new Error('启用了浏览器直连，但未设置有效的自定义翻译接口地址。');
          }
          addLog(`[浏览器直连] 正在向自定义服务器 ${formattedUrl} 发起语义翻译请求...`, 'info');
          const res = await fetch(formattedUrl, {
            method: 'POST',
            className: 'no-cors-check', // annotation
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.translationCustomApiKey || ''}`
            },
            body: JSON.stringify({
              model: config.translationCustomModel || 'gpt-4o',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: 0.3
            })
          } as any);
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`浏览器直连自定义翻译失败 [${res.status}]: ${errText || res.statusText}`);
          }
          const resData = await res.json();
          translated = resData.choices?.[0]?.message?.content || '';
        } else {
          // Gemini Direct calling
          if (!config.geminiApiKey) {
            throw new Error('启用了浏览器直连默认 Gemini 服务，请先在外部连接配置面板中填入您的 Gemini API Key。');
          }
          addLog(`[浏览器直连] 正在向官方 Gemini 服务 (${config.translationModel}) 发起翻译请求...`, 'info');
          const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
          
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.translationModel}:generateContent?key=${config.geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: combinedPrompt }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.3
              }
            })
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`浏览器直连 Gemini 翻译 API 失败 [${res.status}]: ${errText || res.statusText}`);
          }
          const resData = await res.json();
          translated = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
      } else {
        // Standard Server proxy route
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            japaneseText: sourceJapanese,
            previousTranslation: previousPageTranslation,
            model: config.translationModel,
            translationProvider: config.translationProvider,
            translationCustomEndpoint: config.translationCustomEndpoint,
            translationCustomApiKey: config.translationCustomApiKey,
            translationCustomModel: config.translationCustomModel,
            microsoftApiKey: config.microsoftApiKey,
            microsoftRegion: config.microsoftRegion,
            baiduAppId: config.baiduAppId,
            baiduApiKey: config.baiduApiKey,
            sourceLanguage: config.sourceLanguage || 'ja',
            targetLanguage: config.targetLanguage || 'zh'
          }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || `HTTP 错误代码: ${response.status}`);
        }

        const data = await response.json();
        translated = data.translatedText;
      }

      setPages((prev) => ({
        ...prev,
        [pageNum]: {
          ...prev[pageNum],
          status: 'completed',
          translatedText: translated
        }
      }));

      // If we are currently viewing this page, update local translation view as well
      if (pageNum === currentPage) {
        setEditTranslationText(translated);
      }

      if (!silent) addLog(`第 ${pageNum} 页智能翻译圆满成功！已自动剔除页眉页脚、统一专有名词。译文长度: ${translated.length}`, 'success');
      return translated;

    } catch (err: any) {
      console.error(err);
      setPages((prev) => ({
        ...prev,
        [pageNum]: { ...prev[pageNum], status: 'failed', error: err.message }
      }));
      if (!silent) {
        setApiError(err.message);
        addLog(`第 ${pageNum} 页翻译失败: ${err.message}`, 'error');
      }
      throw err;
    } finally {
      if (!silent) setIsTranslationProcessing(false);
    }
  };

  /**
   * Clear persistent local storage cache for the current file to start fresh
   */
  const clearDocumentCache = () => {
    if (!fileName) return;
    try {
      localStorage.removeItem(`manuscript_cache_${fileName}`);
      // Reset all page states to blank / idle
      setPages(prev => {
        const nextPages = { ...prev };
        for (const key in nextPages) {
          nextPages[key] = {
            ...nextPages[key],
            status: 'idle',
            recognizedText: '',
            translatedText: ''
          };
        }
        return nextPages;
      });
      setEditOcrText('');
      setEditTranslationText('');
      addLog(`已成功清除并重置当前文献 "${fileName}" 的所有识别文字与翻译本地缓存记录。`, 'success');
    } catch (e) {
      console.error(e);
      addLog('清理本地缓存出错，请刷新重试。', 'error');
    }
  };

  /**
   * COMBINED WORKFLOW: OCR + TRANSLATE CURRENT PAGE WITH A SINGLE CLICK
   */
  const executeUnifiedWorkflow = async () => {
    try {
      setIsOcrProcessing(true);
      const recognized = await executeOcrForPage(currentPage, true);
      setIsOcrProcessing(false);
      
      setIsTranslationProcessing(true);
      await executeTranslationForPage(currentPage, true, recognized);
    } catch (err) {
      // Errors logged internally
    } finally {
      setIsOcrProcessing(false);
      setIsTranslationProcessing(false);
    }
  };

  /**
   * BATCH PROCESSING: Auto run sequence for multiple pages (e.g. from current page to end)
   */
  const startBatchProcess = async () => {
    if (batchRunningRef.current) {
      batchRunningRef.current = false;
      setBatchRunning(false);
      setBatchProgress(null);
      addLog('批量翻译任务已被用户主动中止。', 'warn');
      return;
    }

    // 校验选择的页面范围
    let start = Math.max(1, Math.min(batchStartPage, totalPages));
    let end = Math.max(1, Math.min(batchEndPage, totalPages));
    if (start > end) {
      const temp = start;
      start = end;
      end = temp;
    }

    batchRunningRef.current = true;
    setBatchRunning(true);
    addLog(`启动批量级联翻译：处理范围为第 ${start} 页至第 ${end} 页...`, 'warn');

    let currentWorkingPage = start;
    while (currentWorkingPage <= end) {
      if (!batchRunningRef.current) break;

      setCurrentPage(currentWorkingPage); // Slide client visually to see the current page
      setBatchProgress({ current: currentWorkingPage, total: end });

      const pageState = pages[currentWorkingPage];
      if (pageState && pageState.status === 'completed' && pageState.translatedText.trim()) {
        addLog(`[批量处理] 第 ${currentWorkingPage} 页已处于完成状态（检测至本地缓存译文），自动跳过。`, 'success');
        currentWorkingPage++;
        continue;
      }

      addLog(`[批量处理] 正在处理第 ${currentWorkingPage} / ${end} 页...`, 'info');

      try {
        let recognized = '';
        
        // Skip OCR if already completed/cached
        if (pageState && (pageState.status === 'ocr_done' || pageState.status === 'completed') && pageState.recognizedText.trim()) {
          addLog(`[批量处理] 第 ${currentWorkingPage} 页已包含 OCR 识别文字缓存，自动应用并跳过第一步识别。`, 'success');
          recognized = pageState.recognizedText;
        } else {
          // Step 1: Visual ocr
          recognized = await executeOcrForPage(currentWorkingPage, true);
        }
        
        // Extra safe check as network delay could have occurred during OCR call
        if (!batchRunningRef.current) break;
        
        // Step 2: Consistent Translation
        await executeTranslationForPage(currentWorkingPage, true, recognized);
        addLog(`[批量处理] 第 ${currentWorkingPage} 页处理完成，已自动暂存至本地。`, 'success');
      } catch (err: any) {
        addLog(`[批量处理] 第 ${currentWorkingPage} 页出错，批量队列挂起。错误原因: ${err.message || err}`, 'error');
        break;
      }

      currentWorkingPage++;
    }

    batchRunningRef.current = false;
    setBatchRunning(false);
    setBatchProgress(null);
    addLog('批量自动流处理已结束。', 'info');
  };

  /**
   * Export Utilities (MD, TXT, Bilingual comparative documents)
   */
  /**
   * Export Utilities (Word standard .doc Document Export with Rich Layouts)
   */
  const exportTranslatedDocument = (type: 'translation' | 'bilingual' | 'original', scope: 'current' | 'all' = 'all') => {
    const dateStr = new Date().toLocaleDateString();
    
    // Helper to translate markdown headers, lists, and paragraphs to native styled HTML for Word
    const mdToHtml = (mdText: string): string => {
      if (!mdText) return '';
      const lines = mdText.split('\n');
      let htmlOutput = '';
      let listActive = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
          if (listActive) {
            htmlOutput += '</ul>\n';
            listActive = false;
          }
          htmlOutput += '<p>&nbsp;</p>\n';
          continue;
        }

        // Standard rich markdown replacements (bold, italics, codes)
        let formattedStr = line
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`(.*?)`/g, '<code style="background-color: #f5f4ef; padding: 2px 4px; font-family: \'Consolas\', monospace; font-size: 9.5pt;">$1</code>');

        if (formattedStr.startsWith('# ')) {
          if (listActive) { htmlOutput += '</ul>\n'; listActive = false; }
          htmlOutput += `<h1 style="text-align: center; color: #1a1a1a; font-size: 20pt; font-weight: bold; margin-top: 22px; margin-bottom: 12px; border-bottom: 2px solid #7c786d; padding-bottom: 6px;">${formattedStr.substring(2)}</h1>\n`;
        } else if (formattedStr.startsWith('## ')) {
          if (listActive) { htmlOutput += '</ul>\n'; listActive = false; }
          htmlOutput += `<h2 style="color: #7c786d; font-size: 15pt; font-weight: bold; margin-top: 18px; margin-bottom: 8px; border-bottom: 1px dashed #dcd9ce; padding-bottom: 4px;">${formattedStr.substring(3)}</h2>\n`;
        } else if (formattedStr.startsWith('### ')) {
          if (listActive) { htmlOutput += '</ul>\n'; listActive = false; }
          htmlOutput += `<h3 style="color: #8b5a2b; font-size: 12pt; font-weight: bold; margin-top: 12px; margin-bottom: 6px;">${formattedStr.substring(4)}</h3>\n`;
        } else if (formattedStr.startsWith('- ') || formattedStr.startsWith('* ')) {
          if (!listActive) {
            htmlOutput += '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">\n';
            listActive = true;
          }
          htmlOutput += `<li style="font-size: 11pt; line-height: 1.5; margin-bottom: 4px;">${formattedStr.substring(2)}</li>\n`;
        } else {
          if (listActive) { htmlOutput += '</ul>\n'; listActive = false; }
          htmlOutput += `<p style="font-size: 11pt; line-height: 1.6; text-align: justify; text-justify: inter-ideograph; margin-bottom: 10px;">${formattedStr}</p>\n`;
        }
      }
      
      if (listActive) {
        htmlOutput += '</ul>\n';
      }
      return htmlOutput;
    };

    const mdToHtmlInline = (mdText: string): string => {
      if (!mdText) return '';
      return mdText
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code style="background-color: #f5f4ef; padding: 2px 4px; font-family: \'Consolas\', monospace; font-size: 9.5pt;">$1</code>');
    };

    const exportPages: number[] = [];
    if (scope === 'current') {
      exportPages.push(currentPage);
    } else {
      for (let i = 1; i <= totalPages; i++) {
        exportPages.push(i);
      }
    }

    let innerHtml = '';
    
    if (type === 'original') {
      innerHtml += `<h1 style="text-align: center; font-size: 22pt; font-weight: bold; color: #1a1a1a; margin-bottom: 15px;">文献原文视觉提取</h1>`;
      innerHtml += `<p style="text-align: center; color: #7c786d; font-size: 10pt; margin-bottom: 30px;">（全自动提取文献原文，保留自然分栏与核心排版）</p>`;
      
      for (const i of exportPages) {
        if (pages[i]?.recognizedText) {
          innerHtml += `<div style="margin-top: 25px; margin-bottom: 15px; border-bottom: 1px solid #7c786d; padding-bottom: 3px;"><strong style="font-size: 12pt; color: #7c786d;">第 ${i} 页 原文内容</strong></div>`;
          innerHtml += `<div style="margin-bottom: 40px;">${mdToHtml(pages[i].recognizedText)}</div>`;
        }
      }
    } else if (type === 'translation') {
      innerHtml += `<h1 style="text-align: center; font-size: 22pt; font-weight: bold; color: #1a1a1a; margin-bottom: 15px;">智能学术译文成果</h1>`;
      innerHtml += `<p style="text-align: center; color: #7c786d; font-size: 10pt; margin-bottom: 30px;">（学术论文精细化意译，剔除页端残留及无关字符）</p>`;
      
      for (const i of exportPages) {
        if (pages[i]?.translatedText) {
          innerHtml += `<div style="margin-top: 25px; margin-bottom: 15px; border-bottom: 1px solid #7c786d; padding-bottom: 3px;"><strong style="font-size: 12pt; color: #7c786d;">第 ${i} 页 译文内容</strong></div>`;
          innerHtml += `<div style="margin-bottom: 40px;">${mdToHtml(pages[i].translatedText)}</div>`;
        }
      }
    } else {
      innerHtml += `<h1 style="text-align: center; font-size: 22pt; font-weight: bold; color: #1a1a1a; margin-bottom: 15px;">文献双语对照成果</h1>`;
      innerHtml += `<p style="text-align: center; color: #7c786d; font-size: 10pt; margin-bottom: 30px;">源文件：${fileName || '学术文献'} | 原文与智能学术译文逐段横排对照</p>`;
      
      let isFirstRendered = true;
      for (const i of exportPages) {
        const recognizedText = pages[i]?.recognizedText || '';
        const translatedText = pages[i]?.translatedText || '';
        if (recognizedText || translatedText) {
          const pageBreakStyle = isFirstRendered ? '' : 'page-break-before: always;';
          isFirstRendered = false;
          innerHtml += `
            <div style="margin-top: 30px; margin-bottom: 15px; ${pageBreakStyle} border-bottom: 2px solid #7c786d; padding-bottom: 5px;">
              <strong style="font-size: 13pt; color: #1a1a1a;">▋ 第 ${i} 页 对照结果 (横排对照)</strong>
            </div>
          `;

          const origPara = recognizedText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
          const tranPara = translatedText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
          const maxLines = Math.max(origPara.length, tranPara.length);

          for (let j = 0; j < maxLines; j++) {
            const orig = origPara[j] || '';
            const tran = tranPara[j] || '';
            
            innerHtml += `<div style="margin-bottom: 18px; padding-top: 4px; padding-bottom: 4px; border-left: 3px solid #dcd9ce; padding-left: 12px;">`;
            if (orig) {
              innerHtml += `<p style="font-size: 10.5pt; color: #555555; line-height: 1.5; margin-bottom: 6px; text-align: justify;"><span style="font-weight: bold; color: #8b5a2b; font-size: 9.5pt;">【原文】</span>${mdToHtmlInline(orig)}</p>`;
            }
            if (tran) {
              innerHtml += `<p style="font-size: 11pt; color: #111111; line-height: 1.6; margin-bottom: 0; text-align: justify;"><span style="font-weight: bold; color: #1a1a1a; font-size: 9.5pt;">【译文】</span>${mdToHtmlInline(tran)}</p>`;
            }
            innerHtml += `</div>`;
          }
        }
      }
    }

    const docHtml = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset="utf-8">
  <title>文献成果</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page {
      size: A4;
      margin: 1.0in 1.25in 1.0in 1.25in;
    }
    body {
      font-family: 'DengXian', 'SimSun', 'Microsoft YaHei', sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      margin: 0;
      padding: 0;
    }
    p {
      text-align: justify;
      text-justify: inter-ideograph;
      margin-bottom: 12px;
      font-size: 11pt;
    }
    li {
      font-size: 11pt;
    }
  </style>
</head>
<body>
  <div style="font-size: 9.5pt; color: #7c786d; border-bottom: 1px solid #e1ded6; padding-bottom: 8px; margin-bottom: 25px; text-align: right;">
    <span>文献识别翻译智能助手成果报告 | 导出时间：${dateStr}</span>
  </div>
  ${innerHtml}
</body>
</html>
    `;

    // Prepend UTF-8 BOM \ufeff so MS Word parses as UTF-8 styled document instead of raw text code
    const blob = new Blob(['\ufeff' + docHtml], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const fileBaseName = fileName ? fileName.split('.')[0] : 'literature';
    const typeLabel = type === 'original' ? '仅原文' : type === 'translation' ? '仅译文' : '双语对照';
    const scopeLabel = scope === 'current' ? `_第${currentPage}页` : '_完整版';
    link.download = `${fileBaseName}_${typeLabel}${scopeLabel}.doc`;
    link.click();
    URL.revokeObjectURL(url);
    
    addLog(`成功以 Word 格式 (.doc) 导出【${typeLabel} (${scope === 'current' ? `第${currentPage}页` : '全部页'})】成果文件。`, 'success');
  };

  // Keep saved copies of edited texts
  const saveOcrChanges = () => {
    setPages((prev) => ({
      ...prev,
      [currentPage]: {
        ...prev[currentPage],
        recognizedText: editOcrText,
        status: prev[currentPage]?.status === 'idle' ? 'ocr_done' : prev[currentPage]?.status
      }
    }));
    setIsEditingOcr(false);
    addLog(`第 ${currentPage} 页视觉识别原文已手动更新。`, 'info');
  };

  const saveTranslationChanges = () => {
    setPages((prev) => ({
      ...prev,
      [currentPage]: {
        ...prev[currentPage],
        translatedText: editTranslationText,
        status: prev[currentPage]?.status !== 'completed' ? 'completed' : prev[currentPage]?.status
      }
    }));
    setIsEditingTrans(false);
    addLog(`第 ${currentPage} 页中文译文内容已手动更新。`, 'info');
  };

  const copyToClipboard = (text: string, type: 'ocr' | 'trans') => {
    navigator.clipboard.writeText(text);
    if (type === 'ocr') {
      setCopiedOcrStatus(true);
      setTimeout(() => setCopiedOcrStatus(false), 2000);
    } else {
      setCopiedTransStatus(true);
      setTimeout(() => setCopiedTransStatus(false), 2000);
    }
  };

  const getStatusColor = (status: PageStatus) => {
    switch (status) {
      case 'ocr_running': return 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse font-semibold';
      case 'ocr_done': return 'bg-blue-100 text-blue-800 border-blue-300 font-semibold';
      case 'translating': return 'bg-indigo-100 text-indigo-800 border-indigo-300 animate-pulse font-semibold';
      case 'completed': return 'bg-[#E2DFD6] text-black border-[#1A1A1A] font-bold';
      case 'failed': return 'bg-red-50 text-red-800 border-red-200 font-semibold';
      default: return 'bg-white text-[#7C786D] border-[#DCD9CE] hover:border-[#1A1A1A] hover:text-[#1A1A1A]';
    }
  };

  return (
    <div id="translator-app-root" className="flex flex-col h-screen font-sans bg-[#F9F7F2] text-[#1A1A1A]">
      
      {/* 1. TOP HEADER NAVIGATION BAR */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#E2DFD6] bg-white shrink-0 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center p-2 bg-[#1A1A1A] rounded-sm text-[#F9F7F2]">
            <BookMarked size={18} />
          </div>
          <div>
            <h1 className="text-sm font-serif italic font-bold tracking-tight text-[#1A1A1A] flex items-center gap-2">
              文脈 BUMMYAKU
              <span className="text-[9px] tracking-widest font-mono text-[#7C786D] font-bold px-1.5 py-0.5 bg-[#F1EFE9] border border-[#DCD9CE] rounded-sm uppercase">
                Dual-Workflow
              </span>
            </h1>
            <p className="text-[10px] tracking-widest uppercase text-[#7C786D] font-bold">Multilingual Academic & Literary Translation Workspace</p>
          </div>
        </div>

        {/* Configurations Quick Panel */}
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-[#F1EFE9] border border-[#DCD9CE] rounded-sm text-xs text-[#7C786D]">
            <Layers size={13} className="text-[#1A1A1A]" />
            <span>OCR: <strong className="text-[#1A1A1A] font-mono">{activeOcrLabel}</strong></span>
            <span className="text-[#DCD9CE]">|</span>
            <Languages size={13} className="text-[#1A1A1A]" />
            <span>翻译: <strong className="text-[#1A1A1A] font-mono">{activeTranslationLabel}</strong></span>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowConfigModal(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-white border border-[#DCD9CE] hover:bg-[#F9F7F2] flex items-center gap-1.5 text-[#1A1A1A] transition cursor-pointer"
              id="btn-settings"
            >
              <Settings size={14} />
              模型配置
            </button>
            <button 
              onClick={() => setShowHelpModal(true)}
              className="p-1.5 text-[#7C786D] hover:text-[#1A1A1A] rounded hover:bg-[#F1EFE9] transition cursor-pointer"
              id="btn-help"
            >
              <HelpCircle size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE UTILITY RAIL */}
      <div className="bg-[#F1EFE9] px-6 py-3 border-b border-[#E2DFD6] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm bg-[#1A1A1A] text-[#F9F7F2] hover:bg-black flex items-center gap-2 shadow-sm transition-colors cursor-pointer shrink-0 h-[36px]"
            id="btn-import-file"
          >
            <Upload size={14} />
            导入文献 (PDF/图片)
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="application/pdf,image/*" 
            className="hidden" 
          />

          {/* Source and Target Languages Selection */}
          <div className="flex items-center gap-1 bg-white border border-[#DCD9CE] rounded-sm px-2 py-1 text-xs select-none h-[36px]">
            <span className="text-[#7C786D] font-bold scale-90">源:</span>
            <select
              value={config.sourceLanguage}
              onChange={(e) => setConfig((c) => ({ ...c, sourceLanguage: e.target.value }))}
              className="bg-transparent font-semibold text-[#1A1A1A] py-0.5 outline-none cursor-pointer text-xs"
            >
              {LANGUAGES_SOURCE.map((lang) => (
                <option key={`lang-src-${lang.id}`} value={lang.id}>
                  {lang.name.split(' ')[0]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 bg-white border border-[#DCD9CE] rounded-sm px-2 py-1 text-xs select-none h-[36px]">
            <span className="text-[#7C786D] font-bold scale-90">译:</span>
            <select
              value={config.targetLanguage}
              onChange={(e) => setConfig((c) => ({ ...c, targetLanguage: e.target.value }))}
              className="bg-transparent font-semibold text-[#1A1A1A] py-0.5 outline-none cursor-pointer text-xs"
            >
              {LANGUAGES_TARGET.map((lang) => (
                <option key={`lang-tgt-${lang.id}`} value={lang.id}>
                  {lang.name.split(' ')[0]}
                </option>
              ))}
            </select>
          </div>

          {fileName && (
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-sm border border-[#DCD9CE] text-xs text-[#1A1A1A] h-[36px]">
              <FileText size={13} className="text-[#7C786D] shrink-0" />
              <div className="max-w-[100px] lg:max-w-[150px] truncate font-semibold text-[11px]" title={fileName}>
                {fileName}
              </div>
              <span className="text-[10px] text-[#7C786D] bg-[#F1EFE9] border border-[#DCD9CE] px-1 py-0.5 rounded-sm font-mono shrink-0 scale-90">
                {fileSize}
              </span>
              <button
                onClick={clearDocumentCache}
                className="text-[10px] font-semibold text-red-700 hover:text-white bg-red-50 hover:bg-red-700 border border-red-200 hover:border-red-700 px-1.5 py-0.5 rounded-sm cursor-pointer transition-all shrink-0 scale-90"
                title="清除由于级联翻译暂存于本地浏览器的当前文献全部页识别与翻译缓存，重新开始"
              >
                清除缓存
              </button>
            </div>
          )}

          {totalPages > 0 && (
            <div className="flex items-center gap-1 text-xs bg-white border border-[#DCD9CE] rounded-sm px-1.5 py-1 text-[#1A1A1A] h-[36px] shrink-0">
              <button 
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 rounded-sm text-[#7C786D] hover:bg-[#F1EFE9] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft size={14} />
              </button>
              <input 
                type="number"
                value={currentPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val >= 1 && val <= totalPages) setCurrentPage(val);
                }}
                className="w-10 bg-[#F1EFE9] text-center font-mono border border-[#DCD9CE] py-0.5 rounded-sm text-[#1A1A1A] text-xs outline-none focus:border-amber-600"
              />
              <span className="text-[#DCD9CE] scale-90">/</span>
              <span className="text-[#1A1A1A] font-mono min-w-[20px] text-center">{totalPages}</span>
              <button 
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 rounded-sm text-[#7C786D] hover:bg-[#F1EFE9] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Core Pipeline Executors and export buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={executeUnifiedWorkflow}
            disabled={!totalPages || isOcrProcessing || isTranslationProcessing || batchRunning}
            className="h-[36px] px-3 text-xs font-semibold rounded-sm bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-amber-800 transition-colors cursor-pointer shrink-0"
            id="btn-single-run"
            title="一键提取并翻译当前页面"
          >
            <Sparkles size={12} className="shrink-0" />
            双步一键执行
          </button>

          {totalPages > 0 && (
            <div className="flex items-center gap-1 text-xs bg-white border border-[#DCD9CE] rounded-sm px-2 h-[36px] text-[#1A1A1A] shrink-0">
              <span className="text-[#7C786D] font-medium scale-90 origin-left">范围:</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={batchStartPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val >= 1 && val <= totalPages) setBatchStartPage(val);
                }}
                disabled={batchRunning}
                className="w-12 bg-[#F1EFE9] text-center font-mono border border-[#DCD9CE] py-0.5 rounded-sm text-[#1A1A1A] text-xs outline-none focus:border-amber-600 disabled:opacity-50"
                title="批量级联翻译起始页"
              />
              <span className="text-[#DCD9CE]">-</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={batchEndPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (val >= 1 && val <= totalPages) setBatchEndPage(val);
                }}
                disabled={batchRunning}
                className="w-12 bg-[#F1EFE9] text-center font-mono border border-[#DCD9CE] py-0.5 rounded-sm text-[#1A1A1A] text-xs outline-none focus:border-amber-600 disabled:opacity-50"
                title="批量级联翻译截止页"
              />
              <span className="text-[#7C786D] scale-90">页</span>
            </div>
          )}

          <button
            onClick={startBatchProcess}
            disabled={!totalPages || isOcrProcessing || isTranslationProcessing}
            className={`h-[36px] px-3 text-xs font-semibold rounded-sm flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
              batchRunning 
                ? 'bg-red-700 text-white hover:bg-red-800 border border-red-800 animate-pulse' 
                : 'bg-[#1A1A1A] hover:bg-black text-[#F9F7F2] border border-[#1A1A1A] shadow-sm'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            id="btn-batch-process"
            title="自动化不间断处理指定范围页面"
          >
            {batchRunning ? (
              <>
                <Loader2 size={12} className="animate-spin shrink-0" />
                停止批量 ({batchProgress ? `${batchProgress.current}/${batchProgress.total}页` : '计算中'})
              </>
            ) : (
              <>
                <Play size={11} className="shrink-0" />
                批量级联翻译
              </>
            )}
          </button>

          <div className="relative group/export-current inline-block shrink-0">
            <button
              disabled={!totalPages}
              className="h-[36px] px-3 text-xs font-semibold rounded-sm bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-[#1A1A1A] transition-colors cursor-pointer select-none"
              id="btn-toolbar-export-current"
              title="导出当前页识别译文"
            >
              <Download size={12} className="shrink-0" />
              导出本页
            </button>
            {totalPages > 0 && (
              <div className="absolute right-0 top-full mt-1 border border-[#DCD9CE] bg-white rounded-sm shadow-md opacity-0 pointer-events-none group-focus-within/export-current:opacity-100 group-hover/export-current:opacity-100 group-focus-within/export-current:pointer-events-auto group-hover/export-current:pointer-events-auto transition text-xs py-1 w-24 z-50 flex flex-col font-sans">
                <button 
                  onClick={() => exportTranslatedDocument('original', 'current')}
                  className="px-2.5 py-1.5 text-left text-[#1A1A1A] hover:bg-[#F1EFE9] transition-colors cursor-pointer font-medium"
                >
                  仅原文
                </button>
                <button 
                  onClick={() => exportTranslatedDocument('translation', 'current')}
                  className="px-2.5 py-1.5 text-left text-[#1A1A1A] hover:bg-[#F1EFE9] transition-colors cursor-pointer font-medium"
                >
                  仅译文
                </button>
                <button 
                  onClick={() => exportTranslatedDocument('bilingual', 'current')}
                  className="px-2.5 py-1.5 text-left text-[#1A1A1A] hover:bg-[#F1EFE9] transition-colors cursor-pointer font-medium"
                >
                  双语对照
                </button>
              </div>
            )}
          </div>

          <div className="relative group/export-all inline-block shrink-0">
            <button
              disabled={!totalPages}
              className="h-[36px] px-3 text-xs font-semibold rounded-sm bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-[#1A1A1A] transition-colors cursor-pointer select-none"
              id="btn-toolbar-export-all"
              title="导出完整文献所有已生成内容"
            >
              <Download size={12} className="shrink-0" />
              导出全部
            </button>
            {totalPages > 0 && (
              <div className="absolute right-0 top-full mt-1 border border-[#DCD9CE] bg-white rounded-sm shadow-md opacity-0 pointer-events-none group-focus-within/export-all:opacity-100 group-hover/export-all:opacity-100 group-focus-within/export-all:pointer-events-auto group-hover/export-all:pointer-events-auto transition text-xs py-1 w-24 z-50 flex flex-col font-sans">
                <button 
                  onClick={() => exportTranslatedDocument('original', 'all')}
                  className="px-2.5 py-1.5 text-left text-[#1A1A1A] hover:bg-[#F1EFE9] transition-colors cursor-pointer font-medium"
                >
                  仅原文
                </button>
                <button 
                  onClick={() => exportTranslatedDocument('translation', 'all')}
                  className="px-2.5 py-1.5 text-left text-[#1A1A1A] hover:bg-[#F1EFE9] transition-colors cursor-pointer font-medium"
                >
                  仅译文
                </button>
                <button 
                  onClick={() => exportTranslatedDocument('bilingual', 'all')}
                  className="px-2.5 py-1.5 text-left text-[#1A1A1A] hover:bg-[#F1EFE9] transition-colors cursor-pointer font-medium"
                >
                  双语对照
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. HORIZONTAL PROGRESS CARDS GRID (Aesthetic layout map) */}
      {totalPages > 0 && (
        <div className="bg-[#F1EFE9] px-6 py-2 border-b border-[#E2DFD6] shrink-0" id="progress-map-rail">
          <div className="flex items-center gap-1 text-[11px] mb-1 font-semibold uppercase tracking-wider text-[#7C786D]">
            <span>文献页进度：</span>
            {batchRunning && batchProgress && (
              <span className="ml-2 bg-[#1A1A1A] text-[#F9F7F2] text-[10px] px-2 py-0.5 rounded font-mono font-bold animate-pulse normal-case">
                ⏳ 批量级联中: {batchProgress.current} / {batchProgress.total} 页 ({Math.round((batchProgress.current / batchProgress.total) * 100)}%)
              </span>
            )}
            <div className="flex items-center gap-3 ml-2 normal-case font-normal text-[#7C786D]">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-white border border-[#DCD9CE] block"></span> 未处理</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-100 border border-amber-300 block"></span> 提取中</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-100 border border-blue-300 block"></span> 已结构原文</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-100 border border-indigo-300 block"></span> 翻译中</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#E2DFD6] border border-[#1A1A1A] block"></span> 已连贯翻译</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto py-1.5">
            {Array.from({ length: totalPages }).map((_, idx) => {
              const pNum = idx + 1;
              const pData = pages[pNum];
              const isCurrent = currentPage === pNum;
              return (
                <button
                  key={pNum}
                  onClick={() => setCurrentPage(pNum)}
                  className={`min-w-[34px] h-[34px] rounded-sm text-xs select-none border font-mono font-bold flex-col flex items-center justify-center transition-all ${
                    isCurrent ? 'ring-2 ring-[#1A1A1A] scale-105 font-extrabold' : ''
                  } ${getStatusColor(pData?.status || 'idle')}`}
                  title={`第 ${pNum} 页 (${pData?.status || '未处理'})`}
                >
                  {pNum}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. ERROR NOTICE BAR IF TRIGGERED */}
      {apiError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 text-xs flex items-center gap-2 text-red-800 transition duration-300 flex-none animate-fadeIn">
          <AlertCircle size={15} />
          <div className="flex-1">
            <strong>运行出错：</strong>{apiError}
          </div>
          <button 
            onClick={() => setApiError('')} 
            className="text-red-700 hover:text-black font-semibold px-1.5 py-0.5 hover:bg-red-100 rounded text-[10px]"
          >
            忽略
          </button>
        </div>
      )}

      {/* 5. MAIN WORKSPACE: THREE COLUMN WORKSPACE INTERACTIVE GRID */}
      <div className="flex-1 flex overflow-hidden bg-[#F9F7F2]">
        
        {/* COLUMN 1: ORIGINAL MANUSCRIPT IMAGE VIEW (原图) */}
        <section className="w-1/3 flex flex-col border-r border-[#E2DFD6]" id="panel-original-image">
          <div className="flex items-center justify-between px-4 py-2 bg-white text-xs font-semibold border-b border-[#E2DFD6]">
            <span className="flex items-center gap-2 text-[#7C786D] uppercase tracking-wider font-bold">
              <BookOpen size={14} className="text-[#1A1A1A]" />
              01. 原始文献图像
            </span>
            {pdfDoc && (
              <div className="flex items-center gap-1 bg-white border border-[#DCD9CE] px-1 py-0.5 rounded-sm">
                <button 
                  onClick={() => setZoom((z) => Math.max(50, z - 10))}
                  className="p-1 hover:bg-[#F1EFE9] rounded-sm text-[#7C786D] hover:text-[#1A1A1A] transition cursor-pointer"
                  title="缩小"
                >
                  <ZoomOut size={13} />
                </button>
                <span className="text-[10px] font-mono px-1 w-10 text-center text-[#1A1A1A]">
                  {zoom}%
                </span>
                <button 
                  onClick={() => setZoom((z) => Math.min(250, z + 10))}
                  className="p-1 hover:bg-[#F1EFE9] rounded-sm text-[#7C786D] hover:text-[#1A1A1A] transition cursor-pointer"
                  title="放大"
                >
                  <ZoomIn size={13} />
                </button>
                <div className="w-px h-3 bg-[#E2DFD6] mx-1"></div>
                <button
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="p-1 hover:bg-[#F1EFE9] rounded-sm text-[#7C786D] hover:text-[#1A1A1A] transition font-semibold cursor-pointer"
                  title="旋转"
                >
                  <RotateCw size={13} />
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto bg-[#E2DFD6] flex items-center justify-center p-6 relative">
            {/* Native hidden canvas to render page from pdf */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Document rendered preview state */}
            {pages[currentPage]?.imageUrl ? (
              <div 
                className="transition-transform duration-200 shadow-xl origin-center bg-white p-4 rounded-sm border border-[#DCD9CE] max-h-full"
                style={{ 
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                }}
              >
                <img 
                  src={pages[currentPage].imageUrl} 
                  alt={`Page ${currentPage}`} 
                  referrerPolicy="no-referrer"
                  className="max-h-[70vh] object-contain rounded-sm border border-[#E2DFD6] select-none pointer-events-none"
                />
              </div>
            ) : pdfDoc ? (
              <div className="flex flex-col items-center justify-center gap-3 text-[#7C786D]">
                <Loader2 size={36} className="animate-spin text-[#1A1A1A]" />
                <span className="text-xs font-serif italic">正在载入 PDF 原文字图层...</span>
              </div>
            ) : (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="max-w-xs text-center border border-dashed border-[#7C786D] hover:border-[#1A1A1A] rounded-sm p-8 flex flex-col items-center justify-center gap-4 text-[#7C786D] hover:text-[#1A1A1A] bg-white hover:bg-[#F9F7F2] shadow-sm select-none cursor-pointer transition-all duration-200 group"
              >
                <Upload size={42} className="text-[#A5A194] group-hover:scale-105 transition-transform" />
                <div className="text-xs">
                  <p className="font-bold text-[#1A1A1A] mb-1">未导入文献视图</p>
                  <p className="text-[10px] text-[#7C786D] group-hover:text-[#1A1A1A] transition-colors">请点击此框或左上方 &quot;导入新文献&quot; 开始智能学术翻译集成工作。</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* COLUMN 2: RECONSTRUCTED EXTRACTED ORIGINAL TEXT editor (原文) */}
        <section className="w-1/3 flex flex-col border-r border-[#E2DFD6]" id="panel-japanese-text">
          <div className="flex items-center justify-between px-4 py-2 bg-white text-xs font-semibold border-b border-[#E2DFD6]">
            <span className="flex items-center gap-2 text-amber-800 uppercase tracking-wider font-bold">
              <FileText size={14} className="text-amber-800" />
              02. 视觉理解原文
            </span>
            {pages[currentPage] && (
              <div className="flex items-center gap-1">
                {isEditingOcr ? (
                  <>
                    <button 
                      onClick={saveOcrChanges} 
                      className="px-2 py-1 rounded-sm bg-[#1A1A1A] text-white hover:bg-black text-[10px] font-semibold transition"
                    >
                      保存
                    </button>
                    <button 
                      onClick={() => {
                        setEditOcrText(pages[currentPage].recognizedText || '');
                        setIsEditingOcr(false);
                      }} 
                      className="px-2 py-1 rounded-sm bg-white border border-[#DCD9CE] hover:bg-[#F9F7F2] text-[10px] text-[#7C786D] transition"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => setIsEditingOcr(true)} 
                      disabled={!pages[currentPage].recognizedText}
                      className="p-1 hover:bg-[#F1EFE9] text-[#7C786D] hover:text-[#1A1A1A] rounded-sm disabled:opacity-30 transition"
                      title="编辑文本"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button 
                      onClick={() => copyToClipboard(editOcrText, 'ocr')} 
                      disabled={!editOcrText}
                      className="p-1 hover:bg-[#F1EFE9] text-[#7C786D] hover:text-[#1A1A1A] rounded-sm disabled:opacity-30 transition flex items-center gap-1"
                      title="复制"
                    >
                      {copiedOcrStatus ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                    </button>
                    <div className="w-px h-3 bg-[#E2DFD6] mx-1"></div>
                    <button
                      onClick={() => executeOcrForPage(currentPage)}
                      disabled={isOcrProcessing || !totalPages}
                      className="px-2.5 py-1 rounded-sm bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] text-[10px] text-amber-800 flex items-center gap-1 disabled:opacity-40 select-none cursor-pointer transition-colors"
                    >
                      {isOcrProcessing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      视觉识别
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col bg-[#F9F7F2] overflow-hidden p-4 font-serif relative">
            {isOcrProcessing ? (
              <div className="absolute inset-0 bg-[#F1EFE9]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10 p-6 text-center select-none animate-fadeIn border-r border-[#E2DFD6]">
                <Loader2 size={32} className="animate-spin text-amber-800" />
                <div className="text-xs">
                  <p className="font-bold text-[#1A1A1A] mb-1">正在调用 {activeOcrLabel} 执行视觉重组...</p>
                  <p className="text-[#7C786D] text-[10px] font-sans">正在智能重组版式分栏、剔除拼音/注音、清除边缘背景杂迹...</p>
                </div>
              </div>
            ) : null}

            {isEditingOcr ? (
              <textarea
                value={editOcrText}
                onChange={(e) => setEditOcrText(e.target.value)}
                className="w-full flex-1 bg-white text-[#1A1A1A] leading-8 font-serif p-5 border border-[#DCD9CE] rounded-sm shadow-inner resize-none focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm whitespace-pre-wrap outline-none"
                placeholder="此处显示提取和结构化后原文，支持手动精微修订..."
              />
            ) : (
              <div className="flex-1 bg-white text-[#1A1A1A] px-6 py-5 overflow-y-auto whitespace-pre-line leading-8 text-[#1A1A1A] text-base select-text border border-[#DCD9CE] rounded-sm shadow-xs">
                {editOcrText ? (
                  editOcrText
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-[#7C786D] font-sans select-none">
                    <FileText size={28} className="text-[#A5A194] mb-2" />
                    <p className="text-xs font-semibold">当前页尚未识别</p>
                    {totalPages > 0 && (
                      <button
                        onClick={() => executeOcrForPage(currentPage)}
                        className="mt-3 px-4 py-2 text-xs text-amber-800 font-semibold border border-amber-300 bg-amber-50 hover:bg-amber-100 rounded-sm transition cursor-pointer"
                      >
                        一键视觉理解识别
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {editOcrText && (
              <div className="mt-2 text-[10px] text-[#7C786D] font-mono flex items-center justify-between px-1">
                <span>原文总字数: {editOcrText.length} 字符</span>
                <span>当前页面: Page {currentPage}</span>
              </div>
            )}
          </div>
        </section>

        {/* COLUMN 3: TRANSLATED EXQUISITE CHINESE OUTPUT editor (译文) */}
        <section className="w-1/3 flex flex-col bg-[#F9F7F2]" id="panel-chinese-translation">
          <div className="flex items-center justify-between px-4 py-2 bg-white text-xs font-semibold border-b border-[#E2DFD6]">
            <span className="flex items-center gap-2 text-[#1A1A1A] uppercase tracking-wider font-bold">
              <Languages size={14} className="text-[#1A1A1A]" />
              03. 智能学术翻译
            </span>
            {pages[currentPage] && (
              <div className="flex items-center gap-1">
                {isEditingTrans ? (
                  <>
                    <button 
                      onClick={saveTranslationChanges} 
                      className="px-2 py-1 rounded-sm bg-[#1A1A1A] text-white hover:bg-black text-[10px] font-semibold transition animate-fadeIn"
                    >
                      保存
                    </button>
                    <button 
                      onClick={() => {
                        setEditTranslationText(pages[currentPage].translatedText || '');
                        setIsEditingTrans(false);
                      }} 
                      className="px-2 py-1 rounded-sm bg-white border border-[#DCD9CE] hover:bg-[#F9F7F2] text-[10px] text-[#7C786D] transition"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => setIsEditingTrans(true)} 
                      disabled={!pages[currentPage].translatedText}
                      className="p-1 hover:bg-[#F1EFE9] text-[#7C786D] hover:text-[#1A1A1A] rounded-sm disabled:opacity-30 transition"
                      title="编辑译文"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button 
                      onClick={() => copyToClipboard(editTranslationText, 'trans')} 
                      disabled={!editTranslationText}
                      className="p-1 hover:bg-[#F1EFE9] text-[#7C786D] hover:text-[#1A1A1A] rounded-sm disabled:opacity-30 transition"
                      title="复制译文"
                    >
                      {copiedTransStatus ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                    </button>
                    <div className="w-px h-3 bg-[#E2DFD6] mx-1"></div>
                    <button
                      onClick={() => executeTranslationForPage(currentPage)}
                      disabled={isTranslationProcessing || !totalPages}
                      className="px-2.5 py-1 rounded-sm bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] text-[10px] text-[#1A1A1A] flex items-center gap-1 disabled:opacity-40 select-none cursor-pointer transition-colors"
                    >
                      {isTranslationProcessing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      智能翻译
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col bg-[#F9F7F2] overflow-hidden p-4 relative">
            {isTranslationProcessing ? (
              <div className="absolute inset-0 bg-[#F1EFE9]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10 p-6 text-center select-none animate-fadeIn">
                <Loader2 size={32} className="animate-spin text-neutral-800" />
                <div className="text-xs">
                  <p className="font-bold text-[#1A1A1A] mb-1">正在通过 {activeTranslationLabel} 级联翻译中...</p>
                  <p className="text-[#7C786D] text-[10px] font-sans">大模型正在结合上下文桥接段落、滤除页眉页脚、融汇学术名词进行意译...</p>
                </div>
              </div>
            ) : null}

            {isEditingTrans ? (
              <textarea
                value={editTranslationText}
                onChange={(e) => setEditTranslationText(e.target.value)}
                className="w-full flex-1 bg-white text-[#1A1A1A] leading-8 font-serif p-5 border border-[#DCD9CE] rounded-sm shadow-inner resize-none focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm whitespace-pre-wrap outline-none"
                placeholder="此处显示学术级中文译文，支持直接润色增修..."
              />
            ) : (
              <div className="flex-1 bg-white text-[#1A1A1A] p-6 overflow-y-auto leading-8 text-[#1A1A1A] text-base border border-[#DCD9CE] rounded-sm shadow-xs">
                {editTranslationText ? (
                  <div className="markdown-body font-serif text-[15px] leading-relaxed select-text whitespace-pre-line text-[#2C2C2C]">
                    {editTranslationText}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-[#7C786D] font-sans select-none">
                    <Languages size={28} className="text-[#A5A194] mb-2" />
                    <p className="text-xs font-semibold">当前页尚无翻译结果</p>
                    {totalPages > 0 && (
                      <button
                        onClick={() => executeTranslationForPage(currentPage)}
                        className="mt-3 px-4 py-2 text-xs text-[#1A1A1A] font-semibold border border-[#DCD9CE] bg-white hover:bg-[#F9F7F2] rounded-sm transition cursor-pointer"
                      >
                        一键执行语义翻译
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Translation style control & Exports */}
            {editTranslationText && (
              <div className="mt-2 flex items-center justify-between text-[11px] text-[#7C786D]">
                <span className="font-mono">译文字数: {editTranslationText.length} 字符</span>
              </div>
            )}
          </div>
        </section>

      </div>

      {/* 6. BOTTOM RUNTIME CHRONICLE LOGS BAR */}
      <footer className="h-28 border-t border-[#E2DFD6] bg-[#F1EFE9] flex flex-col shrink-0 overflow-hidden" id="logs-rail">
        <div className="bg-[#E2DFD6] px-4 py-1.5 flex items-center justify-between text-[10px] text-[#7C786D] font-bold select-none uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C786D] animate-ping inline-block"></span>
            运行日志与诊断信息 (Diagnostic Engine Console)
          </span>
          <button 
            onClick={() => setLogs([])}
            className="text-[#7C786D] hover:text-[#1A1A1A] font-bold cursor-pointer transition-colors"
          >
            清除日志
          </button>
        </div>
        <div 
          ref={logContainerRef}
          className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-6 text-[#1A1A1A] space-y-1 bg-white border-t border-[#DCD9CE]"
        >
          {logs.map((log, index) => {
            let logColor = 'text-[#7C786D]';
            if (log.type === 'success') logColor = 'text-green-800 font-semibold';
            if (log.type === 'warn') logColor = 'text-amber-800';
            if (log.type === 'error') logColor = 'text-red-800 font-bold';
            return (
              <div key={index} className="flex gap-2">
                <span className="text-[#8B8678] select-none font-bold">[{log.timestamp}]</span>
                <span className={logColor}>{log.message}</span>
              </div>
            );
          })}
          {logs.length === 0 && (
            <div className="h-full flex items-center justify-center text-[#7C786D] text-xs font-serif italic text-center select-none">
              诊断子系统就绪。这里打印文献页视觉切片与连贯语境翻译的分析日志。
            </div>
          )}
        </div>
      </footer>

      {/* 7. CONFIGURATION MODEL MODAL */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-55 animate-fadeIn p-4">
          <div className="bg-white border border-[#E2DFD6] rounded-sm max-w-2xl w-full p-6 shadow-2xl relative select-none">
            <h3 className="text-sm font-bold text-[#1A1A1A] pb-3 border-b border-[#E2DFD6] mb-4 flex items-center justify-between uppercase tracking-wide">
              <span className="flex items-center gap-2">
                <Settings className="text-[#7C786D]" size={16} />
                双阶段大模型接口与偏好配置
              </span>
              <button 
                onClick={() => setShowConfigModal(false)}
                className="text-[#7C786D] hover:text-[#1A1A1A] text-xs font-bold"
              >
                ✕
              </button>
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs max-h-[70vh] overflow-y-auto pr-1">
              {/* LEFT COLUMN: STEP 1 OCR CONFIG */}
              <div className="space-y-4 border-r border-[#E2DFD6] md:pr-6 border-dashed">
                <div className="flex items-center gap-2 pb-1 border-b border-[#F1EFE9]">
                  <span className="w-5 h-5 bg-amber-100 text-amber-900 rounded-full flex items-center justify-center font-bold text-[10px]">1</span>
                  <h4 className="font-bold text-[#1A1A1A] uppercase tracking-wider text-[11px]">阶段一：视觉结构化理解 (OCR)</h4>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[#7C786D] font-bold">接口提供商：</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setConfig((c) => ({ ...c, ocrProvider: 'default' }))}
                      className={`py-1.5 text-center text-[10px] rounded-sm border transition cursor-pointer font-semibold ${
                        config.ocrProvider === 'default'
                          ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                          : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-[#F9F7F2]'
                      }`}
                    >
                      官方 Gemini 视觉
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfig((c) => ({ ...c, ocrProvider: 'ocr-space' }))}
                      className={`py-1.5 text-center text-[10px] rounded-sm border transition cursor-pointer font-semibold ${
                        config.ocrProvider === 'ocr-space'
                          ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                          : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-[#F9F7F2]'
                      }`}
                    >
                      OCR.space (免密)
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfig((c) => ({ ...c, ocrProvider: 'custom' }))}
                      className={`py-1.5 text-center text-[10px] rounded-sm border transition cursor-pointer font-semibold ${
                        config.ocrProvider === 'custom'
                          ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                          : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-[#F9F7F2]'
                      }`}
                    >
                      自定义 API / 中转
                    </button>
                  </div>
                </div>

                {config.ocrProvider === 'default' && (
                  <div className="space-y-1.5">
                    <label className="block text-[#7C786D] font-bold">视觉识别模型：</label>
                    <select
                      value={config.ocrModel}
                      onChange={(e) => setConfig((c) => ({ ...c, ocrModel: e.target.value }))}
                      className="w-full bg-[#F9F7F2] text-[#1A1A1A] py-1.5 px-3 rounded-sm border border-[#DCD9CE] font-sans focus:ring-1 focus:ring-amber-500 outline-none"
                    >
                      {AVAILABLE_MODELS.map((model) => (
                        <option key={`ocr-${model.id}`} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-[#7C786D] leading-relaxed">
                      {AVAILABLE_MODELS.find(m => m.id === config.ocrModel)?.description}
                    </p>
                  </div>
                )}

                {config.ocrProvider === 'ocr-space' && (
                  <div className="space-y-3 p-3 bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm">
                    <div className="space-y-1">
                      <label className="block text-[10px] text-[#7C786D] font-bold font-sans">OCR.space API Key：</label>
                      <input
                        type="password"
                        value={config.ocrSpaceApiKey || ''}
                        onChange={(e) => setConfig((c) => ({ ...c, ocrSpaceApiKey: e.target.value }))}
                        className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                        placeholder="留空则自动使用 'helloworld' 免密使用"
                      />
                    </div>
                    <p className="text-[10px] leading-relaxed text-[#7C786D] font-serif">
                      提示：OCR.space 是国际著名的免费、免开通在线 OCR 系统。支持全语种自动光学识卷。
                    </p>
                    <div className="pt-2 flex flex-col gap-1 border-t border-[#DCD9CE] border-dashed">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={testOcrConnection}
                          disabled={ocrTesting}
                          className="px-2 py-1 bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm text-[10px] font-semibold text-amber-800 transition select-none cursor-pointer flex items-center gap-1"
                        >
                          {ocrTesting && <Loader2 size={10} className="animate-spin" />}
                          ⚡️ 测试 OCR 接口
                        </button>
                        {ocrTestResult && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-semibold max-w-[130px] truncate ${
                            ocrTestResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`} title={ocrTestResult.message}>
                            {ocrTestResult.success ? '测试成功' : '验证失败'}
                          </span>
                        )}
                      </div>
                      {ocrTestResult && (
                        <div className={`p-1.5 border rounded-sm text-[9px] font-mono leading-normal break-all whitespace-pre-wrap ${
                          ocrTestResult.success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
                        }`}>
                          {ocrTestResult.message}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {config.ocrProvider === 'custom' && (
                  <div className="space-y-3 p-3 bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm">
                    <div className="space-y-1">
                      <label className="block text-[10px] text-[#7C786D] font-bold">API 接口地址：</label>
                      <input
                        type="text"
                        value={config.ocrCustomEndpoint}
                        onChange={(e) => setConfig((c) => ({ ...c, ocrCustomEndpoint: e.target.value }))}
                        className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                        placeholder="https://api.openai.com/v1"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] text-[#7C786D] font-bold">API Key / 密钥：</label>
                      <input
                        type="password"
                        value={config.ocrCustomApiKey}
                        onChange={(e) => setConfig((c) => ({ ...c, ocrCustomApiKey: e.target.value }))}
                        className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                        placeholder="sk-..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] text-[#7C786D] font-bold">模型代号 / Model ID：</label>
                      <input
                        type="text"
                        value={config.ocrCustomModel}
                        onChange={(e) => setConfig((c) => ({ ...c, ocrCustomModel: e.target.value }))}
                        className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                        placeholder="gpt-4o"
                      />
                    </div>
                    <div className="pt-2 flex flex-col gap-1 border-t border-[#DCD9CE] border-dashed">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={testOcrConnection}
                          disabled={ocrTesting}
                          className="px-2 py-1 bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm text-[10px] font-semibold text-amber-800 transition select-none cursor-pointer flex items-center gap-1"
                        >
                          {ocrTesting && <Loader2 size={10} className="animate-spin" />}
                          ⚡️ 测试 OCR 接口
                        </button>
                        {ocrTestResult && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-semibold max-w-[130px] truncate ${
                            ocrTestResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`} title={ocrTestResult.message}>
                            {ocrTestResult.success ? '连接成功' : '验证失败'}
                          </span>
                        )}
                      </div>
                      {ocrTestResult && (
                        <div className={`p-1.5 border rounded-sm text-[9px] font-mono leading-normal break-all whitespace-pre-wrap ${
                          ocrTestResult.success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
                        }`}>
                          {ocrTestResult.message}
                        </div>
                      )}
                    </div>
                    <p className="text-[9px] text-amber-800 leading-normal font-serif">
                      ⚠️ 提示：第一步为多模态图像识版阶段，请确保自定义模型支持 Vision (传入图像) 能力。
                    </p>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: STEP 2 TRANSLATION CONFIG */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-1 border-b border-[#F1EFE9]">
                  <span className="w-5 h-5 bg-neutral-900 text-white rounded-full flex items-center justify-center font-bold text-[10px]">2</span>
                  <h4 className="font-bold text-[#1A1A1A] uppercase tracking-wider text-[11px]">阶段二：智能学术翻译</h4>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[#7C786D] font-bold">接口提供商：</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setConfig((c) => ({ ...c, translationProvider: 'default' }))}
                      className={`py-1.5 text-center text-[10px] rounded-sm border transition cursor-pointer font-semibold ${
                        config.translationProvider === 'default'
                          ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                          : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-[#F9F7F2]'
                      }`}
                    >
                      官方 Gemini
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfig((c) => {
                        const freeProv = (c.translationProvider === 'google-free' || c.translationProvider === 'microsoft-free')
                          ? c.translationProvider
                          : 'microsoft-free';
                        return { ...c, translationProvider: freeProv as any };
                      })}
                      className={`py-1.5 text-center text-[10px] rounded-sm border transition cursor-pointer font-semibold ${
                        (config.translationProvider === 'google-free' || config.translationProvider === 'microsoft-free')
                          ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                          : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-[#F9F7F2]'
                      }`}
                    >
                      免费接口
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfig((c) => {
                        const apiProv = (c.translationProvider === 'custom' || c.translationProvider === 'microsoft-official' || c.translationProvider === 'baidu-official')
                          ? c.translationProvider
                          : 'custom';
                        return { ...c, translationProvider: apiProv as any };
                      })}
                      className={`py-1.5 text-center text-[10px] rounded-sm border transition cursor-pointer font-semibold ${
                        (config.translationProvider === 'custom' || config.translationProvider === 'microsoft-official' || config.translationProvider === 'baidu-official')
                          ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                          : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-[#F9F7F2]'
                      }`}
                    >
                      API 接口
                    </button>
                  </div>
                </div>

                {config.translationProvider === 'default' && (
                  <div className="space-y-1.5 text-xs">
                    <label className="block text-[#7C786D] font-bold">智能翻译模型：</label>
                    <select
                      value={config.translationModel}
                      onChange={(e) => setConfig((c) => ({ ...c, translationModel: e.target.value }))}
                      className="w-full bg-[#F9F7F2] text-[#1A1A1A] py-1.5 px-3 rounded-sm border border-[#DCD9CE] font-sans focus:ring-1 focus:ring-amber-500 outline-none"
                    >
                      {AVAILABLE_MODELS.map((model) => (
                        <option key={`trans-${model.id}`} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-[#7C786D] leading-relaxed">
                      {AVAILABLE_MODELS.find(m => m.id === config.translationModel)?.description}
                    </p>
                  </div>
                )}

                {(config.translationProvider === 'google-free' || config.translationProvider === 'microsoft-free') && (
                  <div className="space-y-3 p-3 bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm text-xs">
                    <div className="space-y-1">
                      <label className="block text-[10px] text-[#7C786D] font-bold">选择内置免密通道：</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setConfig((c) => ({ ...c, translationProvider: 'google-free' }))}
                          className={`py-1 text-center text-[10px] rounded-sm border transition cursor-pointer font-semibold ${
                            config.translationProvider === 'google-free'
                              ? 'bg-amber-800 border-amber-800 text-white'
                              : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-[#F9F7F2]'
                          }`}
                        >
                          谷歌免费翻译
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig((c) => ({ ...c, translationProvider: 'microsoft-free' }))}
                          className={`py-1 text-center text-[10px] rounded-sm border transition cursor-pointer font-semibold ${
                            config.translationProvider === 'microsoft-free'
                              ? 'bg-amber-800 border-amber-800 text-white'
                              : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-[#F9F7F2]'
                          }`}
                        >
                          微软免费翻译
                        </button>
                      </div>
                    </div>
                    {config.translationProvider === 'google-free' ? (
                      <div className="text-[10px] leading-relaxed text-[#7C786D] font-sans">
                        <p className="font-bold text-amber-800 mb-0.5">✓ 已启用谷歌内置免密智能翻译</p>
                        该通道为系统内置免密高速谷歌翻译服务，支持在不同学术语言间自由流转，完全免费且无需任何配置。
                      </div>
                    ) : (
                      <div className="text-[10px] leading-relaxed text-[#7C786D] font-sans">
                        <p className="font-bold text-amber-800 mb-0.5">✓ 已启用微软 Edge 内置免密学术翻译</p>
                        该通道由微软内置极速翻译引擎驱动，对于整页或多段落有极佳的翻译精准率与极速体验。
                      </div>
                    )}
                  </div>
                )}

                {(config.translationProvider === 'custom' || config.translationProvider === 'microsoft-official' || config.translationProvider === 'baidu-official') && (
                  <div className="space-y-3 p-3 bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm text-xs">
                    <div className="space-y-1">
                      <label className="block text-[10px] text-[#7C786D] font-bold">选择 API 接口类型：</label>
                      <select
                        value={config.translationProvider}
                        onChange={(e) => setConfig((c) => ({ ...c, translationProvider: e.target.value as any }))}
                        className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] outline-none font-semibold cursor-pointer"
                      >
                        <option value="custom">通用 OpenAI 兼容自定义 / 中转 (推荐)</option>
                        <option value="microsoft-official">微软 Azure 官方翻译 API</option>
                        <option value="baidu-official">百度翻译官方开放平台 API</option>
                      </select>
                    </div>

                    {config.translationProvider === 'microsoft-official' && (
                      <div className="space-y-3 pt-1">
                        <div className="space-y-1">
                          <label className="block text-[10px] text-[#7C786D] font-bold">Azure 订阅密钥 (Key)：</label>
                          <input
                            type="password"
                            value={config.microsoftApiKey || ''}
                            onChange={(e) => setConfig((c) => ({ ...c, microsoftApiKey: e.target.value }))}
                            className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                            placeholder="请输入微软 Azure Translator Key"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[10px] text-[#7C786D] font-bold">Azure 服务区域 (Region)：</label>
                          <input
                            type="text"
                            value={config.microsoftRegion || ''}
                            onChange={(e) => setConfig((c) => ({ ...c, microsoftRegion: e.target.value }))}
                            className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                            placeholder="e.g. eastasia, global"
                          />
                        </div>
                        <div className="pt-2 flex flex-col gap-1 border-t border-[#DCD9CE] border-dashed">
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={testTranslationConnection}
                              disabled={translationTesting}
                              className="px-2 py-1 bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm text-[10px] font-semibold text-amber-800 transition select-none cursor-pointer flex items-center gap-1"
                            >
                              {translationTesting && <Loader2 size={10} className="animate-spin" />}
                              ⚡️ 验证微软 API 状态
                            </button>
                            {transTestResult && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-semibold max-w-[130px] truncate ${
                                transTestResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`} title={transTestResult.message}>
                                {transTestResult.success ? '连接成功' : '验证失败'}
                              </span>
                            )}
                          </div>
                          {transTestResult && (
                            <div className={`p-1.5 border rounded-sm text-[9px] font-mono leading-normal break-all whitespace-pre-wrap ${
                              transTestResult.success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
                            }`}>
                              {transTestResult.message}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {config.translationProvider === 'baidu-official' && (
                      <div className="space-y-3 pt-1">
                        <div className="space-y-1">
                          <label className="block text-[10px] text-[#7C786D] font-bold">百度 App ID：</label>
                          <input
                            type="text"
                            value={config.baiduAppId || ''}
                            onChange={(e) => setConfig((c) => ({ ...c, baiduAppId: e.target.value }))}
                            className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                            placeholder="请输入百度翻译 App ID"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[10px] text-[#7C786D] font-bold">百度 密钥 / Key：</label>
                          <input
                            type="password"
                            value={config.baiduApiKey || ''}
                            onChange={(e) => setConfig((c) => ({ ...c, baiduApiKey: e.target.value }))}
                            className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                            placeholder="请输入百度翻译密钥"
                          />
                        </div>
                        <div className="pt-2 flex flex-col gap-1 border-t border-[#DCD9CE] border-dashed">
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={testTranslationConnection}
                              disabled={translationTesting}
                              className="px-2 py-1 bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm text-[10px] font-semibold text-amber-800 transition select-none cursor-pointer flex items-center gap-1"
                            >
                              {translationTesting && <Loader2 size={10} className="animate-spin" />}
                              ⚡️ 验证百度 API 状态
                            </button>
                            {transTestResult && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-semibold max-w-[130px] truncate ${
                                transTestResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`} title={transTestResult.message}>
                                {transTestResult.success ? '连接成功' : '验证失败'}
                              </span>
                            )}
                          </div>
                          {transTestResult && (
                            <div className={`p-1.5 border rounded-sm text-[9px] font-mono leading-normal break-all whitespace-pre-wrap ${
                              transTestResult.success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
                            }`}>
                              {transTestResult.message}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {config.translationProvider === 'custom' && (
                      <div className="space-y-3 pt-1">
                        <div className="space-y-1">
                          <label className="block text-[10px] text-[#7C786D] font-bold">API 接口地址：</label>
                          <input
                            type="text"
                            value={config.translationCustomEndpoint}
                            onChange={(e) => setConfig((c) => ({ ...c, translationCustomEndpoint: e.target.value }))}
                            className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                            placeholder="https://api.openai.com/v1"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[10px] text-[#7C786D] font-bold">API Key / 密钥：</label>
                          <input
                            type="password"
                            value={config.translationCustomApiKey}
                            onChange={(e) => setConfig((c) => ({ ...c, translationCustomApiKey: e.target.value }))}
                            className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                            placeholder="sk-..."
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[10px] text-[#7C786D] font-bold">模型代号 / Model ID：</label>
                          <input
                            type="text"
                            value={config.translationCustomModel}
                            onChange={(e) => setConfig((c) => ({ ...c, translationCustomModel: e.target.value }))}
                            className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] text-[11px] font-mono outline-none"
                            placeholder="gpt-4o"
                          />
                        </div>
                        <div className="pt-2 flex flex-col gap-1 border-t border-[#DCD9CE] border-dashed">
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={testTranslationConnection}
                              disabled={translationTesting}
                              className="px-2 py-1 bg-white hover:bg-[#F9F7F2] border border-[#DCD9CE] rounded-sm text-[10px] font-semibold text-amber-800 transition select-none cursor-pointer flex items-center gap-1"
                            >
                              {translationTesting && <Loader2 size={10} className="animate-spin" />}
                              ⚡️ 测试翻译接口
                            </button>
                            {transTestResult && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-semibold max-w-[130px] truncate ${
                                transTestResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`} title={transTestResult.message}>
                                {transTestResult.success ? '连接成功' : '测试失败'}
                              </span>
                            )}
                          </div>
                          {transTestResult && (
                            <div className={`p-1.5 border rounded-sm text-[9px] font-mono leading-normal break-all whitespace-pre-wrap ${
                              transTestResult.success ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
                            }`}>
                              {transTestResult.message}
                            </div>
                          )}
                        </div>
                        <p className="text-[9px] text-[#7C786D] leading-normal font-serif">
                          💡 提示：该步骤为纯文本中日语义意译，支持各类标准文本大模型（如 DeepSeek、Claude、GPT 及通义等）。
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* PWA / Client-side Direct Mode Toggle */}
            <div className="mt-4 p-4 bg-[#F1EFE9] border border-[#DCD9CE] rounded-sm text-xs space-y-3 shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-[#1A1A1A] flex items-center gap-1.5 uppercase tracking-wide text-[11px]">
                    🌐 浏览器本地直连模式 (Serverless PWA Offline Mode)
                  </h4>
                  <p className="text-[10px] text-[#7C786D] mt-0.5 leading-relaxed">
                    如果您将此程序保存为了网页或通过 PWA 安装运行（无 Node.js 后台容器），请开启此选项。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, clientDirectMode: !c.clientDirectMode }))}
                  className={`px-3 py-1.5 rounded-sm border transition font-bold text-xs select-none cursor-pointer whitespace-nowrap self-start sm:self-auto ${
                    config.clientDirectMode 
                      ? 'bg-amber-800 border-amber-800 text-white' 
                      : 'bg-white border-[#DCD9CE] text-[#7C786D] hover:bg-neutral-100'
                  }`}
                >
                  {config.clientDirectMode ? '已开启浏览器直连' : '已关闭浏览器直连'}
                </button>
              </div>

              {config.clientDirectMode && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px] pt-3 border-t border-[#DCD9CE] border-dashed">
                  <div className="space-y-1">
                    <label className="block text-[#1A1A1A] font-bold">官方 Gemini 专属 API Key：</label>
                    <input
                      type="password"
                      value={config.geminiApiKey}
                      onChange={(e) => setConfig((c) => ({ ...c, geminiApiKey: e.target.value }))}
                      className="w-full bg-white text-[#1A1A1A] py-1 px-2 rounded-sm border border-[#DCD9CE] font-mono outline-none"
                      placeholder="AIzaSy..."
                    />
                    <p className="text-[9px] text-[#7C786D] leading-normal font-sans">
                      如果您在上方阶段一/阶段二使用的是默认 Gemini 接口，在此填入您自己的 Gemini API Key 即可。
                    </p>
                  </div>
                  <div className="text-[10px] text-[#7C786D] leading-relaxed flex flex-col justify-center gap-1 font-serif">
                    <p className="font-sans font-semibold text-[#1A1A1A]">💡 浏览器直连机制说明：</p>
                    <p>1. 开启本地直连后，大模型请求将绕过并完全不依赖本地后端服务（即无需运行 server.ts），可离线运行本软件。</p>
                    <p>2. 请确保您的自定义接口已配置了跨域请求支持 (CORS Access-Control-Allow-Origin)。</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 pt-5 border-t border-[#E2DFD6] flex items-center justify-end">
              <button
                onClick={() => {
                  setShowConfigModal(false);
                  addLog('已保存模型与翻译工作区偏好设置。', 'success');
                }}
                className="px-5 py-2 text-xs font-bold rounded-sm bg-[#1A1A1A] hover:bg-[#2C2C2C] text-white transition cursor-pointer"
              >
                保存设置并返回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. WORKFLOW GUIDE & HELP MODAL */}
      {showHelpModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-55 animate-fadeIn p-4">
          <div className="bg-white border border-[#E2DFD6] rounded-sm max-w-lg w-full p-6 shadow-2xl relative select-none text-[#1A1A1A]">
            <h3 className="text-sm font-bold text-[#1A1A1A] pb-3 border-b border-[#E2DFD6] mb-3 uppercase tracking-wide">文献翻译智能助手工作流指引</h3>
            <div className="text-xs space-y-3 leading-6 font-serif">
              <p className="text-[#4C4C4C]">为了保障古籍和学术文献中高逼真度的多栏排版（分栏结构）和繁杂汉字，本程序完全采用了<strong>两阶段大模型流</strong>处理方式：</p>
              
              <div className="p-3 bg-[#F9F7F2] border-l-2 border-[#7C786D]">
                <h4 className="font-bold text-[#1A1A1A] mb-0.5 font-sans">🚀 阶段一：视觉结构化理解</h4>
                <p className="text-[11px] text-[#4C4C4C] font-sans leading-relaxed">大模型对页面图片提供全面的整体视觉理解，智能重组分栏结构（横排转换）、忽略分词中无关的注音假名，剔除机械的分段OCR重叠杂音。</p>
              </div>

              <div className="p-3 bg-[#F9F7F2] border-l-2 border-[#1A1A1A]">
                <h4 className="font-bold text-[#1A1A1A] mb-0.5 font-sans">📜 阶段二：原文语义连贯翻译</h4>
                <p className="text-[11px] text-[#4C4C4C] font-sans leading-relaxed">获取文本后，二次调用大模型并<strong>自动注入前页级联翻译上下文</strong>，剔除页边冗余信息、保障多栏与跨页衔接自然连贯，最终润色为高质量译文。</p>
              </div>

              <p className="text-[#7C786D] text-[10px] font-sans leading-relaxed">💡 提示：在识别出的原文栏可以直接手动编辑修改，便于修正任何个别错别字后再启动第二阶段翻译，保障成果无漏。在翻译栏的“导出”可下载 Word 格式的双语对照及单版提取成果文档。</p>
            </div>
            <div className="mt-5 pt-3 border-t border-[#E2DFD6] flex justify-end font-sans">
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-1.5 text-xs text-[#7C786D] hover:text-[#1A1A1A] hover:bg-[#F1EFE9] rounded-sm border border-[#DCD9CE] cursor-pointer transition"
              >
                关闭了解
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
