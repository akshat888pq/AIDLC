import { useState, useRef, useCallback } from 'react';
import type { UploadedFile } from '../types';
import * as api from '../services/api';

interface Props {
  sessionId: string;
  onFilesUploaded: (files: UploadedFile[]) => void;
}

const ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.md,.txt,.markdown';

export default function FileUpload({ sessionId, onFilesUploaded }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setIsUploading(true);
      try {
        const uploaded = await api.uploadFiles(sessionId, files);
        onFilesUploaded(uploaded);
      } catch (err: any) {
        alert(`Upload failed: ${err.message}`);
      } finally {
        setIsUploading(false);
      }
    },
    [sessionId, onFilesUploaded]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`relative border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
        isDragging
          ? 'border-accent bg-accent/5'
          : 'border-slate-300 hover:border-accent/50 hover:bg-slate-50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {isUploading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-600">Uploading and parsing...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">
              Drop files here or <span className="text-accent">browse</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">
              PDF, DOCX, XLSX, CSV, Markdown, TXT — up to 50 MB each
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
