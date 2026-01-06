import { useState, useCallback, useMemo } from 'react';
import { Upload, FileImage, FileText, Loader2, Trash2, CheckSquare, Square, Package, Check, Files, AlertCircle, Lock, ShieldCheck, ChevronUp, SlidersHorizontal, Maximize, Cpu, RefreshCw, KeyRound, HardDrive, Hash, Settings2, Layers } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';

/**
 * PDF.js 配置
 */
const PDFJS_VERSION = '4.4.168';
const pdfjs = (pdfjsLib as any).default || pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

interface ProcessedImage {
  id: number;
  data: string;
  width: number;
  height: number;
  size: number;
}

type OutputFormat = 'IMAGE' | 'PDF';

export default function PDFToImageConverter() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('IMAGE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // 密碼相關
  const [sourcePassword, setSourcePassword] = useState('');
  const [outputPassword, setOutputPassword] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [isPasswordError, setIsPasswordError] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);

  // 輸出效能與體積設定
  const [renderScale, setRenderScale] = useState(1.5); 
  const [imgQuality, setImgQuality] = useState(0.75); 
  const [showExportSettings, setShowExportSettings] = useState(false);

  // 頁碼選取設定
  const [pageRangeInput, setPageRangeInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 下載與生成狀態
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState<string>('');

  const estimatedSize = useMemo(() => {
    const selected = images.filter(img => selectedIds.has(img.id));
    const totalBytes = selected.reduce((acc, img) => acc + img.size, 0);
    if (totalBytes === 0) return "0 KB";
    return totalBytes > 1024 * 1024 
      ? `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`
      : `${(totalBytes / 1024).toFixed(1)} KB`;
  }, [images, selectedIds]);

  const resetAll = useCallback(() => {
    setPdfFile(null);
    setImages([]);
    setSelectedIds(new Set());
    setPageRangeInput('');
    setSourcePassword('');
    setOutputPassword('');
    setShowPasswordPrompt(false);
    setIsPasswordError(false);
    setIsUnlocked(false);
    setProgress({ current: 0, total: 0 });
    setErrorMsg(null);
  }, []);

  const parseAndApplyRange = useCallback(() => {
    const input = pageRangeInput.trim();
    if (!input) return;
    
    const newSelected = new Set<number>();
    const parts = input.split(/[,，]/);
    
    parts.forEach(p => {
      const range = p.trim().split('-');
      if (range.length === 1) {
        const val = parseInt(range[0]);
        if (!isNaN(val)) newSelected.add(val);
      } else if (range.length === 2) {
        const start = parseInt(range[0]);
        const end = parseInt(range[1]);
        if (!isNaN(start) && !isNaN(end)) {
          const s = Math.min(start, end);
          const e = Math.max(start, end);
          for (let i = s; i <= e; i++) newSelected.add(i);
        }
      }
    });

    const validSelection = new Set<number>();
    newSelected.forEach(id => {
      if (id >= 1 && id <= progress.total) validSelection.add(id);
    });

    if (validSelection.size > 0) {
      setSelectedIds(validSelection);
    }
  }, [pageRangeInput, progress.total]);

  const processFile = async (file: File, isReParsing = false, customPassword?: string) => {
    if (!file) return;
    
    setIsProcessing(true);
    setErrorMsg(null);
    setPdfFile(file);

    await new Promise(r => setTimeout(r, 100));
    if (!isReParsing) setImages([]);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ 
        data: arrayBuffer,
        password: customPassword || sourcePassword,
        cMapUrl: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`,
        cMapPacked: true,
      });

      const pdf = await loadingTask.promise;
      setShowPasswordPrompt(false);
      setIsPasswordError(false);
      setIsUnlocked(true);

      const totalPages = pdf.numPages;
      setProgress({ current: 0, total: totalPages });
      
      const newImagesList: ProcessedImage[] = [];

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { alpha: false });
        
        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({ canvasContext: context, viewport }).promise;
          const imgData = canvas.toDataURL('image/jpeg', imgQuality);
          const sizeInBytes = Math.floor((imgData.length - 22) * 0.75);

          const imgObj = { id: i, data: imgData, width: viewport.width, height: viewport.height, size: sizeInBytes };
          newImagesList.push(imgObj);
          if (!isReParsing) {
            setImages(prev => [...prev, imgObj]);
            setSelectedIds(prev => new Set([...Array.from(prev), i]));
          }
          setProgress(prev => ({ ...prev, current: i }));
          canvas.width = 0; canvas.height = 0;
        }
      }
      if (isReParsing) {
        setImages(newImagesList);
        setShowExportSettings(false); 
      }
    } catch (error: any) {
      if (error.name === 'PasswordException' || error.message?.toLowerCase().includes('password')) {
        setShowPasswordPrompt(true);
        if (customPassword || sourcePassword) setIsPasswordError(true);
      } else {
        setErrorMsg(error.message || '檔案解析失敗');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPDF = async () => {
    const selected = images.filter(img => selectedIds.has(img.id)).sort((a,b) => a.id - b.id);
    if (selected.length === 0) return;
    setExportType('正在加密並匯出 PDF...');
    setIsExporting(true);
    
    setTimeout(() => {
      try {
        const doc = new jsPDF({
          orientation: selected[0].width > selected[0].height ? 'l' : 'p',
          unit: 'pt',
          format: [selected[0].width, selected[0].height],
          compress: true
        });

        if (outputPassword) {
          (doc as any).setEncryption({
            userPassword: outputPassword,
            ownerPassword: outputPassword,
            userPermissions: ['print', 'copy', 'modify']
          });
        }

        selected.forEach((img, index) => {
          if (index > 0) doc.addPage([img.width, img.height], img.width > img.height ? 'l' : 'p');
          doc.addImage(img.data, 'JPEG', 0, 0, img.width, img.height, undefined, 'FAST');
        });

        doc.save(`${pdfFile?.name.replace(/\.[^/.]+$/, "")}_safe.pdf`);
      } catch (e) {
        alert('匯出失敗');
      } finally {
        setIsExporting(false);
      }
    }, 500);
  };

  const downloadZip = async () => {
    const selected = images.filter(img => selectedIds.has(img.id));
    if (selected.length === 0) return;
    setExportType('正在打包圖片 ZIP...');
    setIsExporting(true);
    try {
      const zip = new JSZip();
      selected.forEach(img => zip.file(`page_${img.id}.jpg`, img.data.split(',')[1], { base64: true }));
      const blob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${pdfFile?.name.replace(/\.[^/.]+$/, "")}_images.zip`;
      link.click();
    } finally { setIsExporting(false); }
  };

  const downloadLongImage = async () => {
    const selected = images.filter(img => selectedIds.has(img.id)).sort((a,b) => a.id - b.id);
    if (selected.length === 0) return;
    setExportType('正在生成拼接長圖...');
    setIsExporting(true);

    setTimeout(async () => {
      try {
        const maxWidth = Math.max(...selected.map(img => img.width));
        const totalHeight = selected.reduce((acc, img) => acc + img.height, 0);
        
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = totalHeight;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          let currentY = 0;
          for (const imgObj of selected) {
            const imgEl = new Image();
            imgEl.src = imgObj.data;
            await new Promise(resolve => imgEl.onload = resolve);
            ctx.drawImage(imgEl, (maxWidth - imgObj.width) / 2, currentY);
            currentY += imgObj.height;
          }
          
          const link = document.createElement('a');
          link.href = canvas.toDataURL('image/jpeg', imgQuality);
          link.download = `${pdfFile?.name.replace(/\.[^/.]+$/, "")}_long.jpg`;
          link.click();
        }
      } catch (e) {
        alert('長圖生成失敗');
      } finally {
        setIsExporting(false);
      }
    }, 500);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === images.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(images.map(img => img.id)));
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans pb-24 selection:bg-blue-600">
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-slate-800 p-5 sticky top-0 z-30 shadow-2xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-3 rounded-[1.25rem] shadow-xl shadow-blue-500/20"><FileImage className="w-7 h-7 text-white" /></div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">PDF 轉圖片神器</h1>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em]">Pure Client-Side Engine</p>
            </div>
          </div>
          {pdfFile && (
            <button onClick={resetAll} className="flex items-center gap-2 px-5 py-2.5 text-sm bg-slate-800 hover:bg-red-500/10 text-slate-400 hover:text-red-400 rounded-2xl transition-all border border-slate-700 font-black shadow-lg">
              <Trash2 className="w-4 h-4" /> <span>重選檔案</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        {!pdfFile ? (
          <div className="relative border-2 border-dashed rounded-[4rem] p-32 text-center transition-all duration-1000 group border-slate-800 bg-slate-900/10 hover:border-blue-500/40 hover:bg-blue-500/5 shadow-2xl" onDragOver={e => {e.preventDefault();}} onDrop={e => {e.preventDefault(); if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0])}}>
            <input type="file" accept=".pdf" onChange={e => e.target.files?.[0] && processFile(e.target.files[0])} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="flex flex-col items-center gap-12 pointer-events-none">
              <div className="p-16 rounded-[3rem] bg-slate-900 border border-slate-800 shadow-3xl group-hover:scale-110 group-hover:rotate-3 transition-all duration-700">
                <Upload className="w-24 h-24 text-blue-500 group-hover:text-white transition-colors" />
              </div>
              <div className="space-y-4">
                <h2 className="text-5xl font-black text-white tracking-tighter">將 PDF 拖曳至此</h2>
                <p className="text-slate-500 text-xl font-medium max-w-lg mx-auto leading-relaxed">我們在您的本地瀏覽器處理所有內容，隱私無憂，解析飛快。</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-12 duration-1000 space-y-6">
            {/* 主操作欄 */}
            <div className="bg-slate-900/90 backdrop-blur-3xl border border-white/5 rounded-[3rem] p-6 flex flex-wrap items-center justify-between gap-6 shadow-[0_40px_80px_rgba(0,0,0,0.6)] sticky top-[108px] z-20">
              <div className="flex items-center gap-6">
                <div className="p-4 bg-blue-500/10 rounded-3xl border border-blue-500/20 relative shadow-inner">
                  <FileText className="w-8 h-8 text-blue-400" />
                  <div className="absolute -top-2 -right-2">
                     {isUnlocked ? <ShieldCheck className="w-6 h-6 text-emerald-500 drop-shadow-lg" /> : <Lock className="w-6 h-6 text-red-500" />}
                  </div>
                </div>
                <div>
                  <h3 className="font-black text-white text-xl max-w-[200px] truncate">{pdfFile.name}</h3>
                  <div className="flex items-center gap-3 mt-1 opacity-70">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">選取 {selectedIds.size} / {progress.total} 頁</p>
                    <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                    <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">預估 {estimatedSize}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {/* 頁碼範圍輸入 */}
                <div className="flex items-center gap-2 bg-slate-950/80 p-2 rounded-2xl border border-slate-800 shadow-inner focus-within:border-blue-500/50 transition-all">
                  <Hash className="w-4 h-4 text-slate-700 ml-2" />
                  <input type="text" placeholder="1-5, 8" value={pageRangeInput} onChange={e => setPageRangeInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && parseAndApplyRange()} className="bg-transparent outline-none py-1.5 px-2 text-sm text-white placeholder:text-slate-900 w-24 font-black" />
                </div>

                {/* 格式切換 */}
                <div className="flex bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800 shadow-inner">
                  <button onClick={() => setOutputFormat('IMAGE')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-[0.2em] transition-all ${outputFormat === 'IMAGE' ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/30' : 'text-slate-500 hover:text-slate-300'}`}>圖片</button>
                  <button onClick={() => setOutputFormat('PDF')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-[0.2em] transition-all ${outputFormat === 'PDF' ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/30' : 'text-slate-500 hover:text-slate-300'}`}>PDF</button>
                </div>

                {/* 全選按鈕 */}
                <button 
                  onClick={toggleSelectAll} 
                  className={`p-4 rounded-2xl border transition-all ${selectedIds.size === images.length ? 'bg-slate-800 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                  title={selectedIds.size === images.length ? "取消全選" : "全選所有頁面"}
                >
                  {selectedIds.size === images.length ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                </button>

                {/* 進階設定開關 */}
                <button onClick={() => setShowExportSettings(!showExportSettings)} className={`p-4 rounded-2xl border transition-all ${showExportSettings ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-white'}`} title="顯示進階設定">
                  {showExportSettings ? <ChevronUp className="w-5 h-5" /> : <SlidersHorizontal className="w-5 h-5" />}
                </button>

                {/* 匯出按鈕組 */}
                <div className="flex items-center gap-3 ml-2">
                  {outputFormat === 'IMAGE' ? (
                    <>
                      <button onClick={downloadLongImage} disabled={selectedIds.size === 0 || isProcessing} className="flex items-center gap-3 px-6 py-4 rounded-[1.5rem] bg-blue-600 hover:bg-blue-500 text-white font-black text-sm transition-all shadow-2xl active:scale-95 disabled:opacity-20">
                        <Layers className="w-5 h-5" /> 拼接長圖
                      </button>
                      <button onClick={downloadZip} disabled={selectedIds.size === 0 || isProcessing} className="flex items-center gap-3 px-6 py-4 rounded-[1.5rem] bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm transition-all shadow-2xl active:scale-95 disabled:opacity-20">
                        <Package className="w-5 h-5" /> 打包圖片
                      </button>
                    </>
                  ) : (
                    <button onClick={downloadPDF} disabled={selectedIds.size === 0 || isProcessing} className="flex items-center gap-3 px-8 py-4 rounded-[1.5rem] bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition-all shadow-2xl active:scale-95 group disabled:opacity-20">
                      <Files className="w-5 h-5 group-hover:rotate-12" /> 匯出加密 PDF <span className="opacity-50 text-[10px]">({estimatedSize})</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 進階設定面板 */}
            {showExportSettings && (
              <div className="bg-slate-900 border border-white/5 rounded-[3rem] p-10 shadow-3xl animate-in slide-in-from-top-10 duration-500 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none"><Settings2 className="w-48 h-48" /></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 relative z-10">
                  <div className="space-y-5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2"><Maximize className="w-4 h-4" /> 解析度比例 (DPI)</label>
                    <div className="flex items-center justify-between text-2xl font-black text-white">{renderScale.toFixed(1)}<span className="text-xs text-blue-500">x</span></div>
                    <input type="range" min="0.5" max="3.0" step="0.5" value={renderScale} onChange={e => setRenderScale(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                  </div>

                  <div className="space-y-5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2"><Cpu className="w-4 h-4" /> 圖片壓縮品質</label>
                    <div className="flex items-center justify-between text-2xl font-black text-white">{Math.round(imgQuality * 100)}<span className="text-xs text-emerald-500">%</span></div>
                    <input type="range" min="0.1" max="1.0" step="0.05" value={imgQuality} onChange={e => setImgQuality(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2 mb-3"><Lock className="w-4 h-4" /> 來源 PDF 解鎖密碼</label>
                      <input type="password" placeholder="若有加密請輸入" value={sourcePassword} onChange={e => setSourcePassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-sm font-black outline-none focus:border-blue-500 transition-all placeholder:text-slate-900" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4" /> 設定輸出 PDF 密碼</label>
                      <input type="password" placeholder="匯出後需要密碼開啟" value={outputPassword} onChange={e => setOutputPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-sm font-black outline-none focus:border-emerald-500 transition-all placeholder:text-slate-900" />
                    </div>
                  </div>

                  <div className="flex flex-col justify-end">
                    <button onClick={() => processFile(pdfFile!, true)} disabled={isProcessing} className="w-full py-6 bg-white text-black hover:bg-blue-50 rounded-[2rem] font-black text-sm uppercase tracking-[0.2em] transition-all shadow-2xl shadow-white/10 active:scale-95 flex items-center justify-center gap-3">
                      {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />} 套用設定並重新解析
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 進度 / 匯出 遮罩 */}
            {(isProcessing || isExporting) && (
              <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-2xl flex flex-col items-center justify-center p-8">
                <div className="bg-slate-900 border border-white/5 p-16 rounded-[4rem] shadow-4xl flex flex-col items-center gap-10 max-w-sm w-full">
                  <div className="relative">
                    <Loader2 className="w-24 h-24 animate-spin text-blue-500" />
                    {!isExporting && <div className="absolute inset-0 flex items-center justify-center text-sm font-black text-white">{progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%</div>}
                  </div>
                  <div className="text-center space-y-4">
                    <h4 className="text-3xl font-black text-white tracking-tight">{isExporting ? '匯出中' : '解析中'}</h4>
                    <p className="text-slate-500 font-bold text-[10px] uppercase tracking-[0.3em]">{isExporting ? exportType : `處理進度 ${progress.current} / ${progress.total}`}</p>
                  </div>
                </div>
              </div>
            )}

            {/* 網格預覽 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-10">
              {images.map(img => (
                <div key={img.id} className={`group relative bg-slate-900 rounded-[3rem] overflow-hidden border transition-all duration-500 cursor-pointer shadow-2xl ${selectedIds.has(img.id) ? 'border-blue-500 ring-[16px] ring-blue-500/5 -translate-y-3' : 'border-slate-800 hover:border-slate-600'}`} onClick={() => {const n = new Set(selectedIds); if(n.has(img.id)) n.delete(img.id); else n.add(img.id); setSelectedIds(n);}}>
                  <div className="absolute top-6 left-6 z-10">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border-2 transition-all duration-300 ${selectedIds.has(img.id) ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-950/60 border-slate-700 text-transparent opacity-0 group-hover:opacity-100'}`}><Check className="w-6 h-6 stroke-[5px]" /></div>
                  </div>
                  <div className="aspect-[3/4.2] bg-slate-950 p-4 flex items-center justify-center">
                    <img src={img.data} className={`w-full h-full object-contain transition-all duration-700 ${selectedIds.has(img.id) ? 'opacity-30' : 'group-hover:scale-110'}`} loading="lazy" />
                  </div>
                  <div className="p-8 bg-slate-900 border-t border-white/5 flex justify-between items-center">
                    <div className="space-y-1">
                      <span className={`text-xl font-black block ${selectedIds.has(img.id) ? 'text-blue-400' : 'text-slate-200'}`}>第 {img.id} 頁</span>
                      <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{img.width} × {img.height} PX</p>
                    </div>
                    <div className="bg-slate-950 px-4 py-2 rounded-xl border border-slate-800 text-[10px] text-slate-400 font-black shadow-inner uppercase">{(img.size / 1024).toFixed(0)} KB</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      
      <footer className="fixed bottom-0 w-full bg-slate-950/90 backdrop-blur-3xl border-t border-slate-900 p-6 text-center text-slate-700 text-[10px] font-black uppercase tracking-[0.5em] z-40">Privacy First • 本地解析 • 安全無痕</footer>
      
      {/* 錯誤彈窗 */}
      {errorMsg && (
        <div className="fixed inset-0 z-[120] bg-slate-950/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 animate-in zoom-in duration-500">
          <div className="bg-slate-900 border border-red-500/20 p-16 rounded-[4rem] shadow-4xl max-w-md w-full text-center space-y-10 border-white/5">
            <div className="p-8 rounded-full bg-red-500/10 mx-auto w-fit border border-red-500/20"><AlertCircle className="w-24 h-24 text-red-500" /></div>
            <div>
              <h3 className="text-3xl font-black text-white mb-4 tracking-tighter">處理過程中斷</h3>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">{errorMsg}</p>
            </div>
            <button onClick={resetAll} className="w-full py-6 bg-white text-black font-black rounded-[2rem] transition-all active:scale-95 uppercase tracking-widest text-xs shadow-2xl">返回重試</button>
          </div>
        </div>
      )}
    </div>
  );
}
