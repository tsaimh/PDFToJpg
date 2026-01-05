import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileImage, Download, Image as ImageIcon, FileText, Loader2, Trash2, CheckSquare, Square, Package, Check, Layers, FileUp, Files, AlertCircle } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';

/**
 * PDF.js 配置
 * 嚴格要求版本必須與 index.html 中的 importmap 保持一致 (4.4.168)
 */
const PDFJS_VERSION = '4.4.168';
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

// 確保 Worker 也是 4.4.168 且使用 .mjs 格式
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

interface ProcessedImage {
  id: number;
  data: string;
  width: number;
  height: number;
}

type OutputFormat = 'IMAGE' | 'PDF';

export default function PDFToImageConverter() {
  const [isDragging, setIsDragging] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('IMAGE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isZipping, setIsZipping] = useState(false);
  const [isStitching, setIsStitching] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetAll = useCallback(() => {
    setPdfFile(null);
    setImages([]);
    setSelectedIds(new Set());
    setProgress({ current: 0, total: 0 });
    setErrorMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const processFile = async (file: File) => {
    if (!file) return;
    
    // 基本檢查
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('請選擇有效的 PDF 檔案');
      return;
    }

    setPdfFile(file);
    setImages([]);
    setSelectedIds(new Set());
    setIsProcessing(true);
    setErrorMsg(null);
    setProgress({ current: 0, total: 0 });
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      const loadingTask = pdfjs.getDocument({ 
        data: arrayBuffer,
        cMapUrl: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`,
        cMapPacked: true,
      });

      const pdf = await loadingTask.promise;
      const totalPages = pdf.numPages;
      setProgress({ current: 0, total: totalPages });
      
      for (let i = 1; i <= totalPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d', { 
            alpha: false,
            willReadFrequently: true 
          });
          
          if (context) {
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            context.fillStyle = '#FFFFFF';
            context.fillRect(0, 0, canvas.width, canvas.height);

            const renderTask = page.render({
              canvasContext: context,
              viewport: viewport
            });

            await renderTask.promise;

            const imgData = canvas.toDataURL('image/jpeg', 0.85);
            
            const imgObj: ProcessedImage = {
              id: i,
              data: imgData,
              width: viewport.width,
              height: viewport.height
            };
            
            setImages(prev => [...prev, imgObj]);
            setProgress(prev => ({ ...prev, current: i }));
            
            // 立即釋放 canvas 資源
            canvas.width = 0;
            canvas.height = 0;
          }
        } catch (pageError) {
          console.error(`Page ${i} render error:`, pageError);
        }
      }

    } catch (error: any) {
      console.error('PDF parsing error:', error);
      setErrorMsg(error.message || '無法解析 PDF，請確認檔案是否正確或受保護。');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) processFile(files[0]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) processFile(files[0]);
  };

  const downloadImage = (imgData: string, pageNum: number) => {
    if (!pdfFile) return;
    const link = document.createElement('a');
    link.href = imgData;
    link.download = `${pdfFile.name.replace(/\.[^/.]+$/, "")}_P${pageNum}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSelection = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === images.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(images.map(img => img.id)));
  };

  const downloadSelectedZip = async () => {
    if (selectedIds.size === 0 || !pdfFile) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      const baseName = pdfFile.name.replace(/\.[^/.]+$/, "");
      const folder = zip.folder(baseName);
      if (!folder) throw new Error("ZIP Error");

      images.forEach(img => {
        if (selectedIds.has(img.id)) {
          const data = img.data.split(',')[1];
          folder.file(`Page_${img.id}.jpg`, data, { base64: true });
        }
      });

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}_images.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("打包失敗");
    } finally {
      setIsZipping(false);
    }
  };

  const downloadSelectedLongImage = async () => {
    if (selectedIds.size === 0 || !pdfFile) return;
    setIsStitching(true);
    try {
      const selectedImages = images
        .filter(img => selectedIds.has(img.id))
        .sort((a, b) => a.id - b.id);
        
      const maxWidth = Math.max(...selectedImages.map(img => img.width));
      const totalHeight = selectedImages.reduce((sum, img) => sum + img.height, 0);

      const canvas = document.createElement('canvas');
      canvas.width = maxWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let currentY = 0;
      for (const imgObj of selectedImages) {
        const image = new Image();
        image.src = imgObj.data;
        await new Promise((res) => { image.onload = res; });
        const xOffset = (maxWidth - imgObj.width) / 2;
        ctx.drawImage(image, xOffset, currentY);
        currentY += imgObj.height;
      }

      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/jpeg', 0.8);
      link.download = `${pdfFile.name.replace(/\.[^/.]+$/, "")}_Long.jpg`;
      link.click();
    } catch (error) {
      alert("拼接失敗");
    } finally {
      setIsStitching(false);
    }
  };

  const downloadSelectedPDF = async () => {
    if (selectedIds.size === 0 || !pdfFile) return;
    setIsGeneratingPDF(true);
    try {
      const selectedImages = images
        .filter(img => selectedIds.has(img.id))
        .sort((a, b) => a.id - b.id);

      const firstImg = selectedImages[0];
      const doc = new jsPDF({
        orientation: 'p',
        unit: 'pt',
        format: [firstImg.width, firstImg.height]
      });

      for (let i = 0; i < selectedImages.length; i++) {
        const img = selectedImages[i];
        if (i > 0) doc.addPage([img.width, img.height], 'p');
        doc.addImage(img.data, 'JPEG', 0, 0, img.width, img.height);
      }

      doc.save(`${pdfFile.name.replace(/\.[^/.]+$/, "")}_Modified.pdf`);
    } catch (error) {
      alert("PDF 製作失敗");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500 selection:text-white pb-20">
      <header className="bg-slate-900/80 backdrop-blur-lg border-b border-slate-800 p-4 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-500/20">
              <FileImage className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">PDF 轉圖片神器</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Local Processing • V{PDFJS_VERSION}</p>
            </div>
          </div>
          {pdfFile && (
            <button onClick={resetAll} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded-lg transition-all border border-slate-700 hover:border-red-500/50">
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">清除所有</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {!pdfFile ? (
          <div 
            className={`relative border-2 border-dashed rounded-[2.5rem] p-16 text-center transition-all duration-500 group ${isDragging ? 'border-blue-500 bg-blue-500/5 scale-[0.99]' : 'border-slate-800 bg-slate-900/20 hover:border-slate-700 hover:bg-slate-900/40'}`}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          >
            <input type="file" accept=".pdf" onChange={handleFileSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" ref={fileInputRef} />
            <div className="flex flex-col items-center gap-6 pointer-events-none">
              <div className={`p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl group-hover:scale-110 transition-transform duration-500 ${isDragging ? 'bg-blue-600 border-blue-500' : ''}`}>
                <Upload className={`w-12 h-12 ${isDragging ? 'text-white' : 'text-blue-500'}`} />
              </div>
              <div>
                <h2 className="text-3xl font-bold text-white mb-3">拖放 PDF 檔案到這裡</h2>
                <p className="text-slate-500 text-lg">檔案將完全在您的瀏覽器中處理，絕對安全</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-6 duration-700">
            {errorMsg ? (
              <div className="bg-red-500/10 border border-red-500/50 rounded-2xl p-6 flex flex-col items-center gap-4 text-center mb-8">
                <AlertCircle className="w-12 h-12 text-red-500" />
                <h3 className="text-xl font-bold text-white">發生錯誤</h3>
                <p className="text-slate-400 max-w-md">{errorMsg}</p>
                <button onClick={resetAll} className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-500 transition-colors">返回重新上傳</button>
              </div>
            ) : (
              <>
                <div className="sticky top-[88px] z-10 bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 mb-8 flex flex-wrap items-center justify-between gap-6 shadow-2xl">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-xl"><FileText className="w-6 h-6 text-blue-400" /></div>
                    <div>
                      <h3 className="font-bold text-white truncate max-w-[140px] sm:max-w-xs text-lg">{pdfFile.name}</h3>
                      <p className="text-xs text-slate-500 font-medium">共 {progress.total} 頁 • 已選取 {selectedIds.size} 頁</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex bg-slate-950/50 p-1 rounded-xl border border-slate-800">
                      <button onClick={() => setOutputFormat('IMAGE')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${outputFormat === 'IMAGE' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:text-slate-300'}`}>
                        <ImageIcon className="w-4 h-4" /> 圖片
                      </button>
                      <button onClick={() => setOutputFormat('PDF')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${outputFormat === 'PDF' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-500 hover:text-slate-300'}`}>
                        <FileUp className="w-4 h-4" /> PDF
                      </button>
                    </div>

                    {!isProcessing && (
                      <div className="flex items-center gap-2">
                        <button onClick={toggleSelectAll} className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors border border-slate-700 shadow-sm" title="全選/取消全選">
                          {selectedIds.size === images.length ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                        </button>
                        <div className="w-px h-8 bg-slate-800 mx-1"></div>
                        {outputFormat === 'IMAGE' ? (
                          <>
                            <button onClick={downloadSelectedZip} disabled={selectedIds.size === 0 || isZipping} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${selectedIds.size > 0 && !isZipping ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'}`}>
                              {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />} 打包 ZIP
                            </button>
                            <button onClick={downloadSelectedLongImage} disabled={selectedIds.size === 0 || isStitching} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${selectedIds.size > 0 && !isStitching ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'}`}>
                              {isStitching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />} 拼接長圖
                            </button>
                          </>
                        ) : (
                          <button onClick={downloadSelectedPDF} disabled={selectedIds.size === 0 || isGeneratingPDF} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${selectedIds.size > 0 && !isGeneratingPDF ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'}`}>
                            {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Files className="w-4 h-4" />} 下載 PDF
                          </button>
                        )}
                      </div>
                    )}

                    {isProcessing && (
                      <div className="flex items-center gap-3 bg-blue-500/10 px-4 py-2 rounded-xl border border-blue-500/20">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        <span className="text-blue-400 font-bold text-sm">解析中 {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                  {images.map((img) => {
                    const isSelected = selectedIds.has(img.id);
                    return (
                      <div 
                        key={img.id} 
                        className={`group relative bg-slate-900 rounded-[2rem] overflow-hidden border transition-all duration-300 cursor-pointer shadow-xl ${isSelected ? 'border-blue-500 ring-4 ring-blue-500/10' : 'border-slate-800 hover:border-slate-600'}`}
                        onClick={() => toggleSelection(img.id)}
                      >
                        <div className="absolute top-4 left-4 z-10">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 shadow-2xl border ${isSelected ? 'bg-blue-600 border-blue-500 text-white rotate-0 scale-100' : 'bg-slate-950/60 border-slate-700 text-transparent -rotate-12 scale-90 hover:scale-100 hover:rotate-0 hover:text-slate-400'}`}>
                            <Check className="w-5 h-5 stroke-[3px]" />
                          </div>
                        </div>
                        
                        <div className="aspect-[3/4] bg-slate-950 w-full overflow-hidden flex items-center justify-center relative">
                          <img 
                            src={img.data} 
                            alt={`Page ${img.id}`} 
                            loading="lazy"
                            className={`w-full h-full object-contain transition-all duration-700 ${isSelected ? 'scale-90 opacity-80' : 'group-hover:scale-110'}`} 
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                          
                          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300" onClick={(e) => e.stopPropagation()}>
                             <button 
                                onClick={() => downloadImage(img.data, img.id)} 
                                className="bg-white text-slate-950 font-bold py-3 px-6 rounded-2xl flex items-center gap-2 hover:bg-blue-50 hover:text-blue-600 active:scale-95 transition-all text-sm shadow-2xl"
                             >
                               <Download className="w-4 h-4" /> 下載單頁
                             </button>
                          </div>
                        </div>

                        <div className="p-5 bg-slate-900 border-t border-slate-800 flex justify-between items-center">
                          <div className="flex flex-col">
                            <span className={`text-sm font-bold transition-colors ${isSelected ? 'text-blue-400' : 'text-slate-300'}`}>第 {img.id} 頁</span>
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Resolution: {img.width}x{img.height}</span>
                          </div>
                          <div className="bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
                            <span className="text-[10px] text-slate-400 font-black uppercase">JPG</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  
                  {isProcessing && images.length < progress.total && (
                    <div className="aspect-[3/4] rounded-[2rem] bg-slate-900/50 border-2 border-slate-800 border-dashed flex flex-col items-center justify-center gap-4 animate-pulse">
                      <Loader2 className="w-10 h-10 animate-spin text-slate-700" />
                      <span className="text-slate-600 font-bold text-sm">正在載入頁面...</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-slate-950/80 backdrop-blur-md border-t border-slate-900 p-4 text-center z-10">
        <p className="text-slate-500 text-xs font-medium">© 2024 PDF Tool • 核心版本: {PDFJS_VERSION} • 安全本地處理</p>
      </footer>
    </div>
  );
}