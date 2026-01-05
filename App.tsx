import React, { useState, useRef } from 'react';
import { Upload, FileImage, Download, Image as ImageIcon, FileText, Loader2, Trash2, CheckSquare, Square, Package, Check, Layers } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';

// Handle ESM import differences for PDF.js:
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface ProcessedImage {
  id: number;
  data: string;
  width: number;
  height: number;
}

export default function PDFToImageConverter() {
  const [isDragging, setIsDragging] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  
  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isZipping, setIsZipping] = useState(false);
  const [isStitching, setIsStitching] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
      processFile(files[0]);
    } else {
      alert('請上傳 PDF 檔案');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const processFile = async (file: File) => {
    setPdfFile(file);
    setImages([]);
    setSelectedIds(new Set());
    setIsProcessing(true);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      
      const totalPages = pdf.numPages;
      setProgress({ current: 0, total: totalPages });
      
      const newImages: ProcessedImage[] = [];

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;

          const imgData = canvas.toDataURL('image/jpeg', 0.85);
          
          const imgObj: ProcessedImage = {
            id: i,
            data: imgData,
            width: viewport.width,
            height: viewport.height
          };
          
          newImages.push(imgObj);
          setProgress({ current: i, total: totalPages });
          setImages(prev => [...prev, imgObj]);
        }
      }

    } catch (error) {
      console.error('Error processing PDF:', error);
      alert('讀取 PDF 失敗，請確認檔案是否正確。');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadImage = (imgData: string, pageNum: number) => {
    if (!pdfFile) return;
    const link = document.createElement('a');
    link.href = imgData;
    link.download = `${pdfFile.name.replace('.pdf', '')}_Page_${pageNum}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSelection = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === images.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(images.map(img => img.id)));
    }
  };

  const downloadSelectedZip = async () => {
    if (selectedIds.size === 0 || !pdfFile) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      const folderName = `${pdfFile.name.replace('.pdf', '')}_images`;
      const folder = zip.folder(folderName);
      if (!folder) throw new Error("Failed to create zip folder");

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
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Zip Error:", error);
      alert("打包下載失敗");
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
        
      if (selectedImages.length === 0) return;

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
        await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
        const xOffset = (maxWidth - imgObj.width) / 2;
        ctx.drawImage(image, xOffset, currentY);
        currentY += imgObj.height;
      }

      const longImgData = canvas.toDataURL('image/jpeg', 0.85);
      const link = document.createElement('a');
      link.href = longImgData;
      link.download = `${pdfFile.name.replace('.pdf', '')}_Long_Image.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Stitching Error:", error);
      alert("長圖製作失敗");
    } finally {
      setIsStitching(false);
    }
  };

  const resetAll = () => {
    setPdfFile(null);
    setImages([]);
    setSelectedIds(new Set());
    setProgress({ current: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500 selection:text-white pb-20">
      <header className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-20 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg"><FileImage className="w-6 h-6 text-white" /></div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">PDF 轉圖片神器</h1>
              <p className="text-xs text-slate-400">快速、安全、長圖拼接</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {pdfFile && !isProcessing && (
              <button onClick={resetAll} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded-lg transition-colors border border-transparent hover:border-red-500/50">
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">清除</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 mt-4">
        {!pdfFile && (
          <div 
            className={`relative border-2 border-dashed rounded-3xl p-12 text-center transition-all duration-300 group ${isDragging ? 'border-blue-500 bg-blue-500/10 scale-[1.01]' : 'border-slate-700 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-900'}`}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          >
            <input type="file" accept=".pdf" onChange={handleFileSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" ref={fileInputRef} />
            <div className="flex flex-col items-center gap-4 pointer-events-none">
              <div className={`p-6 rounded-full bg-slate-800 mb-2 group-hover:scale-110 transition-transform duration-300 ${isDragging ? 'bg-blue-600' : ''}`}>
                <Upload className={`w-10 h-10 ${isDragging ? 'text-white' : 'text-blue-400'}`} />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">點擊或拖放 PDF 檔案至此</h2>
              <p className="text-slate-400">將 PDF 轉為高畫質圖片、長圖</p>
            </div>
          </div>
        )}

        {pdfFile && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="sticky top-[80px] z-10 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg"><FileText className="w-5 h-5 text-blue-400" /></div>
                  <div>
                    <h3 className="font-semibold text-white truncate max-w-[150px] sm:max-w-xs">{pdfFile.name}</h3>
                    <p className="text-xs text-slate-400">{progress.total} 頁 • 已選取 {selectedIds.size} 頁</p>
                  </div>
                </div>
              </div>

              {!isProcessing && (
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={toggleSelectAll} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors text-sm font-medium border border-slate-700">
                    {selectedIds.size === images.length && images.length > 0 ? <><CheckSquare className="w-4 h-4 text-blue-400" /> 取消全選</> : <><Square className="w-4 h-4" /> 全選</>}
                  </button>
                  <div className="h-6 w-px bg-slate-700 mx-2 hidden sm:block"></div>
                  <button onClick={downloadSelectedZip} disabled={selectedIds.size === 0 || isZipping || isStitching} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${selectedIds.size > 0 && !isZipping && !isStitching ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/25 active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'}`}>
                    {isZipping ? <><Loader2 className="w-4 h-4 animate-spin" /> 打包中...</> : <><Package className="w-4 h-4" /> 下載 ZIP</>}
                  </button>
                  <button onClick={downloadSelectedLongImage} disabled={selectedIds.size === 0 || isZipping || isStitching} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${selectedIds.size > 0 && !isZipping && !isStitching ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/25 active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'}`}>
                    {isStitching ? <><Loader2 className="w-4 h-4 animate-spin" /> 拼接中...</> : <><Layers className="w-4 h-4" /> 下載長圖</>}
                  </button>
                </div>
              )}

              {isProcessing && (
                <div className="flex items-center gap-2 text-blue-400 text-sm font-medium">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  處理中: {Math.round((progress.current / progress.total) * 100)}%
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {images.map((img) => {
                const isSelected = selectedIds.has(img.id);
                return (
                  <div key={img.id} className={`group relative bg-slate-800 rounded-2xl overflow-hidden border shadow-xl transition-all duration-200 ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-700 hover:border-slate-500'}`} onClick={() => toggleSelection(img.id)}>
                    <div className="absolute top-3 left-3 z-10 cursor-pointer">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center transition-all duration-200 shadow-md border ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-slate-900/80 border-slate-500 text-transparent hover:border-white'}`}><Check className="w-4 h-4" /></div>
                    </div>
                    <div className="aspect-[3/4] bg-slate-900 w-full overflow-hidden flex items-center justify-center relative cursor-pointer">
                      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '10px 10px' }}></div>
                      <img src={img.data} alt={`Page ${img.id}`} className={`w-full h-full object-contain transition-transform duration-500 ${isSelected ? 'scale-95' : 'group-hover:scale-105'}`} />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                         <button onClick={() => downloadImage(img.data, img.id)} className="bg-white/90 text-slate-900 font-bold py-2 px-4 rounded-full flex items-center gap-2 hover:bg-white active:scale-95 transition-transform text-sm shadow-xl backdrop-blur-sm"><Download className="w-4 h-4" />單張下載</button>
                      </div>
                    </div>
                    <div className="p-3 bg-slate-800 border-t border-slate-700 flex justify-between items-center" onClick={(e) => e.stopPropagation()}>
                      <span className={`text-sm font-medium flex items-center gap-2 transition-colors ${isSelected ? 'text-blue-400' : 'text-slate-300'}`}><ImageIcon className="w-4 h-4" />第 {img.id} 頁</span>
                      <span className="text-xs text-slate-500 font-mono">JPG</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}