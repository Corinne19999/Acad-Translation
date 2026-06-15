/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelOption {
  id: string;
  name: string;
  type: 'flash' | 'pro' | 'flash-lite';
  description: string;
  isPaid?: boolean;
}

export type PageStatus = 'idle' | 'ocr_running' | 'ocr_done' | 'translating' | 'completed' | 'failed';

export interface PageData {
  pageNumber: number;
  /** base64 representation or URL of the standard page thumbnail/full-res jpeg */
  imageUrl: string;
  status: PageStatus;
  recognizedText: string; // Output of Step 1
  translatedText: string;  // Output of Step 2
  error?: string;
}

export interface DocumentState {
  fileName: string;
  fileSize: string;
  totalPages: number;
  pages: { [key: number]: PageData };
  currentPage: number;
}

export interface ModelConfig {
  ocrModel: string;
  translationModel: string;
  temperature: number;
  
  // Custom API support
  ocrProvider: 'default' | 'custom' | 'ocr-space';
  ocrCustomEndpoint: string;
  ocrCustomApiKey: string;
  ocrCustomModel: string;
  ocrSpaceApiKey?: string;
  
  translationProvider: 'default' | 'custom' | 'google-free' | 'microsoft-free' | 'microsoft-official' | 'baidu-official';
  translationCustomEndpoint: string;
  translationCustomApiKey: string;
  translationCustomModel: string;
  
  // Microsoft & Baidu Official Translation keys
  microsoftApiKey?: string;
  microsoftRegion?: string;
  baiduAppId?: string;
  baiduApiKey?: string;

  // Fully serverless PWA mode support
  clientDirectMode: boolean;
  geminiApiKey: string;

  // Language customization support
  sourceLanguage: string;
  targetLanguage: string;
}
