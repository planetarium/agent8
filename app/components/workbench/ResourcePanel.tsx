import { memo, useEffect, useState, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  type EditorDocument,
  type OnChangeCallback as OnEditorChange,
  type OnSaveCallback as OnEditorSave,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { PanelHeader } from '~/components/ui/PanelHeader';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Button } from '~/components/ui/Button';
import { Input } from '~/components/ui/Input';
import type { FileMap } from '~/lib/stores/files';
import type { FileHistory } from '~/types/actions';
import { ATTACHMENT_EXTS, WORK_DIR } from '~/utils/constants';
import { renderLogger } from '~/utils/logger';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { ModelViewer } from '~/components/ui/ModelViewer';
import { v4 as uuidv4 } from 'uuid';

interface Asset {
  url: string;
  description: string;
  metadata: Record<string, any>;
}

type Categories = Record<string, Record<string, Asset>>;

interface ResourcePanelProps {
  files?: FileMap;
  unsavedFiles?: Set<string>;
  editorDocument?: EditorDocument;
  selectedFile?: string | undefined;
  isStreaming?: boolean;
  fileHistory?: Record<string, FileHistory>;
  onEditorChange?: OnEditorChange;
  onEditorScroll?: OnEditorScroll;
  onFileSelect?: (value?: string) => void;
  onFileSave?: OnEditorSave;
  onFileReset?: () => void;
}

// 업로드 중인 파일의 상태를 추적하기 위한 타입
interface UploadingAsset {
  id: string;
  file: File;
  progress: number; // 0~100
  status: 'uploading' | 'success' | 'error';
  error?: string;
}

// 타입 정의 업데이트
type UploadResult = {
  url: string;
  description?: string;
  dimensions?: { width?: number; height?: number };
  fileExt: string;
} | null;

export const ResourcePanel = memo(({ files }: ResourcePanelProps) => {
  renderLogger.trace('ResourcePanel');

  const [categories, setCategories] = useState<Categories>({});
  const categoriesRef = useRef<Categories>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<{ key: string; asset: Asset } | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [editedAsset, setEditedAsset] = useState<Asset | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [assetsPath] = useState(`${WORK_DIR}/src/assets.json`);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [verse, setVerse] = useState<string>('');
  const [uploadingAssets, setUploadingAssets] = useState<Record<string, UploadingAsset>>({});
  const [successfulUploads, setSuccessfulUploads] = useState<Record<string, boolean>>({});
  const [isDraggingAssets, setIsDraggingAssets] = useState(false);
  const [, setDraggedAssets] = useState<string[]>([]);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  // 허용되는 파일 확장자 목록
  const allowedFileExtensions = ATTACHMENT_EXTS;

  // categories 변경 시 ref에도 업데이트
  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  useEffect(() => {
    if (!isSaving) {
      loadAssets();
    }
  }, [files, isSaving]);

  useEffect(() => {
    if (files && Object.keys(files).length > 0) {
      initializeVerse();
    }
  }, [files]);

  const loadAssets = async () => {
    setIsLoading(true);

    try {
      if (!files) {
        setIsLoading(false);
        return;
      }

      const assetFile = files[assetsPath];

      if (!assetFile || assetFile.type !== 'file') {
        // assets.json 파일이 없는 경우 기본 카테고리로 초기화
        const defaultCategories = {
          images: {},
          models: {},
          audio: {},
        };

        setCategories(defaultCategories);
        categoriesRef.current = defaultCategories; // 명시적으로 ref도 함께 업데이트
        setSelectedCategory('images'); // 기본 카테고리 선택

        // assets.json 파일 생성
        await createAssetsJsonFile(defaultCategories);

        setIsLoading(false);

        return;
      }

      try {
        const parsed = JSON.parse(assetFile.content);
        setCategories(parsed);
        categoriesRef.current = parsed; // 명시적으로 ref도 함께 업데이트

        if (Object.keys(parsed).length > 0 && !selectedCategory) {
          setSelectedCategory(Object.keys(parsed)[0]);
        }
      } catch (error) {
        console.error('Failed to parse assets.json:', error);
        toast.error('Failed to parse assets.json file');

        // 파싱 실패 시 기본 카테고리로 초기화하고 파일 재생성
        const defaultCategories = {
          images: {},
          models: {},
          audio: {},
        };

        setCategories(defaultCategories);
        categoriesRef.current = defaultCategories; // 명시적으로 ref도 함께 업데이트
        setSelectedCategory('images');

        // 손상된 assets.json 파일 재생성
        await createAssetsJsonFile(defaultCategories);
      }
    } catch (error) {
      console.error('Error loading assets:', error);
      toast.error('Error loading assets');
    } finally {
      setIsLoading(false);
    }
  };

  // assets.json 파일 생성 함수
  const createAssetsJsonFile = async (initialCategories: Categories) => {
    try {
      const content = JSON.stringify(initialCategories, null, 2);

      workbenchStore.setSelectedFile(assetsPath);
      workbenchStore.setCurrentDocumentContent(content);
      await workbenchStore.saveCurrentDocument();
    } catch (error) {
      console.error('Error creating assets.json file:', error);
    }
  };

  const saveAssets = async () => {
    if (!files) {
      return;
    }

    setIsSaving(true);

    try {
      // 현재 상태의 categories를 사용하여 저장
      const content = JSON.stringify(categoriesRef.current, null, 2);

      workbenchStore.setSelectedFile(assetsPath);
      workbenchStore.setCurrentDocumentContent(content);
      await workbenchStore.saveCurrentDocument();

      // 저장 후 상태 갱신 - categoriesRef와 categories 동기화
      setCategories({ ...categoriesRef.current });
    } catch (error) {
      console.error('Error saving assets:', error);
      toast.error('Failed to save assets');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setSelectedAsset(null);
    setEditedAsset(null);
  };

  const handleAssetSelect = (assetKey: string, asset: Asset, isShiftKey: boolean = false) => {
    if (!isShiftKey) {
      // 이미 선택된 에셋을 다시 클릭한 경우 선택 해제
      if (selectedAssets.size === 1 && selectedAssets.has(assetKey)) {
        setSelectedAssets(new Set());
        setSelectedAsset(null);
        setEditedAsset(null);
      } else {
        // 새 에셋 선택
        setSelectedAssets(new Set([assetKey]));
        setSelectedAsset({ key: assetKey, asset });
        setEditedAsset({ ...asset });
      }
    } else {
      const newSelectedAssets = new Set(selectedAssets);

      if (newSelectedAssets.has(assetKey)) {
        newSelectedAssets.delete(assetKey);

        if (newSelectedAssets.size === 0) {
          setSelectedAsset(null);
          setEditedAsset(null);
        } else if (selectedAsset?.key === assetKey) {
          const nextKey = Array.from(newSelectedAssets)[0];
          const nextAsset = categories[selectedCategory!][nextKey];
          setSelectedAsset({ key: nextKey, asset: nextAsset });
          setEditedAsset({ ...nextAsset });
        }
      } else {
        newSelectedAssets.add(assetKey);

        if (newSelectedAssets.size === 1 || selectedAsset === null) {
          setSelectedAsset({ key: assetKey, asset });
          setEditedAsset({ ...asset });
        }
      }

      setSelectedAssets(newSelectedAssets);
    }
  };

  const handleAssetChange = (field: keyof Asset, value: any) => {
    if (!editedAsset) {
      return;
    }

    if (field === 'metadata') {
      try {
        const parsedMetadata = typeof value === 'string' ? JSON.parse(value) : value;
        setEditedAsset({ ...editedAsset, metadata: parsedMetadata });
      } catch {
        setEditedAsset({ ...editedAsset, [field]: value });
      }
    } else {
      setEditedAsset({ ...editedAsset, [field]: value });
    }
  };

  const handleAssetUpdate = () => {
    if (!selectedCategory || !selectedAsset || !editedAsset) {
      return;
    }

    const updatedCategories = { ...categoriesRef.current };
    updatedCategories[selectedCategory][selectedAsset.key] = editedAsset;

    setCategories(updatedCategories);
    setSelectedAsset({ key: selectedAsset.key, asset: editedAsset });

    saveAssets();
  };

  const handleDeleteSelectedAssets = () => {
    if (!selectedCategory || selectedAssets.size === 0) {
      return;
    }

    if (window.confirm(`Are you sure you want to delete ${selectedAssets.size} selected asset(s)?`)) {
      const updatedCategories = { ...categoriesRef.current };

      selectedAssets.forEach((assetKey) => {
        delete updatedCategories[selectedCategory][assetKey];
      });

      setCategories(updatedCategories);
      setSelectedAsset(null);
      setEditedAsset(null);
      setSelectedAssets(new Set());

      saveAssets();
    }
  };

  const handleAddCategory = async () => {
    const categoryName = prompt('Enter new category name:');

    if (!categoryName) {
      return;
    }

    if (categoriesRef.current[categoryName]) {
      toast.error('Category already exists');
      return;
    }

    const updatedCategories = { ...categoriesRef.current };
    updatedCategories[categoryName] = {};

    setCategories(updatedCategories);
    setSelectedCategory(categoryName);

    await saveAssetsWithCategories(updatedCategories);
  };

  const handleDeleteCategory = async () => {
    if (!selectedCategory) {
      return;
    }

    if (window.confirm(`Are you sure you want to delete the category "${selectedCategory}" and all its assets?`)) {
      const updatedCategories = { ...categoriesRef.current };
      delete updatedCategories[selectedCategory];

      setCategories(updatedCategories);
      setSelectedCategory(Object.keys(updatedCategories)[0] || null);
      setSelectedAsset(null);
      setEditedAsset(null);

      await saveAssetsWithCategories(updatedCategories);
    }
  };

  const saveAssetsWithCategories = async (categoriesToSave: Categories) => {
    if (!files) {
      return;
    }

    setIsSaving(true);

    try {
      const content = JSON.stringify(categoriesToSave, null, 2);

      workbenchStore.setSelectedFile(assetsPath);
      workbenchStore.setCurrentDocumentContent(content);
      await workbenchStore.saveCurrentDocument();

      // 성공 후 state와 ref 모두 업데이트
      setCategories(categoriesToSave);
      categoriesRef.current = categoriesToSave;
    } finally {
      setIsSaving(false);
    }
  };

  const getPreviewUrl = (asset: Asset) => {
    if (!asset.url) {
      return null;
    }

    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    const isImage = imageExtensions.some((ext) => asset.url.toLowerCase().endsWith(ext));

    const isImageUrl =
      isImage ||
      asset.url.includes('placehold.co') ||
      asset.url.includes('placeholder.com') ||
      asset.url.includes('unsplash.com') ||
      asset.url.includes('picsum.photos') ||
      asset.url.includes('imgur.com') ||
      /\.(png|jpe?g|gif|svg|webp)/i.test(asset.url);

    if (isImageUrl) {
      return asset.url;
    }

    return null;
  };

  const getAssetType = (asset: Asset) => {
    if (!asset.url) {
      return 'unknown';
    }

    // 이미지 확인
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

    if (
      imageExtensions.some((ext) => asset.url.toLowerCase().endsWith(ext)) ||
      asset.url.includes('placehold.co') ||
      asset.url.includes('placeholder.com') ||
      asset.url.includes('unsplash.com') ||
      asset.url.includes('picsum.photos') ||
      asset.url.includes('imgur.com')
    ) {
      return 'image';
    }

    // 3D 모델 확인
    if (asset.url.toLowerCase().endsWith('.glb') || asset.url.toLowerCase().endsWith('.gltf')) {
      return '3d';
    }

    // 오디오 확인
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a'];

    if (audioExtensions.some((ext) => asset.url.toLowerCase().endsWith(ext))) {
      return 'audio';
    }

    // 비디오 확인
    const videoExtensions = ['.mp4', '.webm', '.mov'];

    if (videoExtensions.some((ext) => asset.url.toLowerCase().endsWith(ext))) {
      return 'video';
    }

    // 폰트 확인
    const fontExtensions = ['.ttf', '.otf', '.woff', '.woff2'];

    if (fontExtensions.some((ext) => asset.url.toLowerCase().endsWith(ext))) {
      return 'font';
    }

    // 텍스트 확인
    const textExtensions = [
      '.txt',
      '.md',
      '.json',
      '.csv',
      '.xml',
      '.yaml',
      '.yml',
      '.toml',
      '.ini',
      '.cfg',
      '.conf',
      '.properties',
    ];

    if (textExtensions.some((ext) => asset.url.toLowerCase().endsWith(ext))) {
      return 'text';
    }

    return 'unknown';
  };

  const getFileNameFromUrl = (url: string): string => {
    if (!url) {
      return '';
    }

    try {
      // URL의 마지막 부분을 파일명으로 가정
      const parts = url.split('/');
      let fileName = parts[parts.length - 1];

      // URL 매개변수 제거
      if (fileName.includes('?')) {
        fileName = fileName.split('?')[0];
      }

      // URL 인코딩 디코드
      return decodeURIComponent(fileName);
    } catch (e) {
      console.error('Error extracting filename from URL:', e);
      return '';
    }
  };

  // verse 값 초기화
  const initializeVerse = async () => {
    if (!files) {
      return;
    }

    const envFilePath = `${WORK_DIR}/.env`;
    const envFile = files[envFilePath];

    if (envFile && envFile.type === 'file') {
      // .env 파일이 존재하는 경우
      const envContent = envFile.content;
      const matches = envContent.match(/VITE_AGENT8_VERSE=([^\s]+)/);

      if (matches && matches[1]) {
        setVerse(matches[1]);
      } else {
        // VITE_AGENT8_VERSE 값이 없으면 새로 생성
        await createOrUpdateVerseInEnv();
      }
    } else {
      // .env 파일이 없는 경우 생성
      await createOrUpdateVerseInEnv();
    }
  };

  // verse 값 생성 또는 업데이트
  const createOrUpdateVerseInEnv = async () => {
    const newVerse = uuidv4();
    setVerse(newVerse);

    const envFilePath = `${WORK_DIR}/.env`;
    const envFile = files?.[envFilePath];

    let envContent = '';

    if (envFile && envFile.type === 'file') {
      envContent = envFile.content;

      // 기존 VITE_AGENT8_VERSE 라인 제거
      envContent = envContent.replace(/VITE_AGENT8_VERSE=([^\n]*)\n?/g, '');
    }

    // 새 VITE_AGENT8_VERSE 값 추가
    envContent = `${envContent}\nVITE_AGENT8_VERSE=${newVerse}\n`;

    // 파일 저장
    workbenchStore.setSelectedFile(envFilePath);
    workbenchStore.setCurrentDocumentContent(envContent);
    await workbenchStore.saveCurrentDocument();
  };

  // 파일 업로드 함수 수정
  const uploadFile = async (file: File, uploadId: string): Promise<UploadResult> => {
    if (!verse || !selectedCategory) {
      // 업로드 실패 상태 업데이트
      setUploadingAssets((prev) => ({
        ...prev,
        [uploadId]: { ...prev[uploadId], status: 'error', error: 'Verse or category not set' },
      }));
      toast.error('Unable to upload: verse or category not set');

      return null;
    }

    // 파일 확장자 확인
    const fileExt = `.${file.name.split('.').pop()?.toLowerCase()}`;

    if (!allowedFileExtensions.includes(fileExt)) {
      // 업로드 실패 상태 업데이트
      setUploadingAssets((prev) => ({
        ...prev,
        [uploadId]: { ...prev[uploadId], status: 'error', error: 'File type not allowed' },
      }));
      toast.error(`File type not allowed. Allowed types: ${allowedFileExtensions.join(', ')}`);

      return null;
    }

    try {
      setIsUploading(true);

      const uploadPath = `assets/${selectedCategory}`;

      // FormData 생성
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', uploadPath);
      formData.append('verse', verse);

      // XMLHttpRequest 대신 fetch를 사용하되 업로드 진행 상황 추적
      const xhr = new XMLHttpRequest();

      return new Promise((resolve, reject) => {
        // 진행 상태 업데이트 이벤트
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);

            // 진행 상태 업데이트
            setUploadingAssets((prev) => ({
              ...prev,
              [uploadId]: { ...prev[uploadId], progress },
            }));
          }
        });

        // 업로드 완료 처리
        xhr.addEventListener('load', async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              console.log('Upload response:', response); // 디버깅 로그 추가

              if (response.success) {
                // 성공 상태 업데이트
                setUploadingAssets((prev) => ({
                  ...prev,
                  [uploadId]: { ...prev[uploadId], status: 'success', progress: 100 },
                }));

                // 성공한 업로드 기록
                setSuccessfulUploads((prev) => ({
                  ...prev,
                  [uploadId]: true,
                }));

                const fileUrl = response.url;

                if (!fileUrl) {
                  console.error('No URL returned from upload API');
                  throw new Error('No URL returned from upload API');
                }

                console.log(`File uploaded successfully. URL: ${fileUrl}`); // 디버깅 로그 추가

                // 이미지인 경우 차원 정보만 가져옴
                const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
                let dimensions = {};

                if (imageExtensions.some((ext) => fileExt.toLowerCase() === ext)) {
                  try {
                    // 이미지 파일인 경우 크기 정보 얻기
                    dimensions = await getImageDimensions(file);
                  } catch (dimError) {
                    console.error('Error getting image dimensions:', dimError);
                  }
                }

                // 즉시 플레이스홀더 업데이트 (URL만 업데이트)
                if (selectedCategory) {
                  const updatedCategories = { ...categoriesRef.current };

                  if (updatedCategories[selectedCategory]) {
                    let found = false;

                    Object.entries(updatedCategories[selectedCategory]).forEach(([key, asset]) => {
                      if (asset.metadata?.uploadId === uploadId) {
                        found = true;
                        updatedCategories[selectedCategory][key] = {
                          ...asset,
                          url: fileUrl, // URL 즉시 업데이트
                          metadata: {
                            ...asset.metadata,
                            ...(dimensions ? dimensions : {}),
                            fileExt, // 파일 확장자 저장
                          },
                        };
                        console.log(`Immediately updated asset ${key} with URL: ${fileUrl}`);
                      }
                    });

                    if (found) {
                      categoriesRef.current = updatedCategories;
                      setCategories(updatedCategories); // 상태도 함께 업데이트
                    }
                  }
                }

                resolve({
                  url: fileUrl,
                  dimensions,
                  fileExt,
                });
              } else {
                throw new Error(response.error || 'Upload failed');
              }
            } catch (error) {
              console.error('Error processing upload response:', error);

              // 에러 상태 업데이트
              setUploadingAssets((prev) => ({
                ...prev,
                [uploadId]: {
                  ...prev[uploadId],
                  status: 'error',
                  error: error instanceof Error ? error.message : 'Unknown error',
                  progress: 0,
                },
              }));
              reject(error);
            }
          } else {
            // 에러 상태 업데이트
            setUploadingAssets((prev) => ({
              ...prev,
              [uploadId]: {
                ...prev[uploadId],
                status: 'error',
                error: `HTTP error: ${xhr.status}`,
                progress: 0,
              },
            }));
            reject(new Error(`HTTP error! Status: ${xhr.status}`));
          }
        });

        // 에러 처리
        xhr.addEventListener('error', () => {
          setUploadingAssets((prev) => ({
            ...prev,
            [uploadId]: {
              ...prev[uploadId],
              status: 'error',
              error: 'Network error',
              progress: 0,
            },
          }));
          reject(new Error('Network error'));
        });

        // 요청 설정 및 전송
        xhr.open('POST', '/api/upload-attachment');
        xhr.send(formData);
      });
    } catch (error: any) {
      console.error('Error uploading file:', error);

      // 에러 상태 업데이트
      setUploadingAssets((prev) => ({
        ...prev,
        [uploadId]: {
          ...prev[uploadId],
          status: 'error',
          error: error.message || 'Unknown error',
          progress: 0,
        },
      }));

      toast.error(`Failed to upload ${file.name}: ${error.message}`);

      return null;
    } finally {
      // 모든 업로드가 완료되었는지 확인
      const allUploadsComplete = Object.values(uploadingAssets).every(
        (asset) => asset.status === 'success' || asset.status === 'error',
      );

      if (allUploadsComplete) {
        setIsUploading(false);
      }
    }
  };

  // 드래그 이벤트 핸들러
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  // 공통 파일 업로드 로직을 별도 함수로 추출
  const processFiles = async (files: File[]) => {
    if (!selectedCategory) {
      toast.error('Please select a category before uploading');
      return false;
    }

    if (files.length === 0) {
      return false;
    }

    // Start uploading process
    setIsUploading(true);

    console.log(`Processing ${files.length} files`);

    // 현재 카테고리 상태 복사
    let updatedCategories = { ...categoriesRef.current };

    // 업로드 상태 플레이스홀더 생성
    const newUploadingAssets: Record<string, UploadingAsset> = {};

    // 파일 이름을 uploadId에 매핑하는 객체 추가
    const fileNameToUploadId: Record<string, string> = {};

    // 각 파일마다 플레이스홀더 생성
    Array.from(files).forEach((file) => {
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      newUploadingAssets[uploadId] = {
        id: uploadId,
        file,
        progress: 0,
        status: 'uploading',
      };

      // 파일 이름과 uploadId 매핑 저장
      fileNameToUploadId[file.name] = uploadId;

      // 플레이스홀더 에셋 추가
      const assetKey = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${file.name.replace(/\.[^/.]+$/, '')}`;
      const placeholderAsset: Asset = {
        url: '', // 초기 URL은 빈 값
        description: file.name,
        metadata: {
          type: file.type,
          uploadId, // 확실하게 uploadId 설정
          isPlaceholder: true,
          originalName: file.name, // 원본 파일명 저장
        },
      };

      // 카테고리에 플레이스홀더 추가
      updatedCategories = {
        ...updatedCategories,
        [selectedCategory]: {
          ...updatedCategories[selectedCategory],
          [assetKey]: placeholderAsset,
        },
      };
    });

    // 카테고리 상태 업데이트
    setCategories(updatedCategories);
    categoriesRef.current = updatedCategories;

    // 업로드 상태 추가
    setUploadingAssets((prev) => ({ ...prev, ...newUploadingAssets }));

    // 각 파일 업로드 시작
    const uploadResults = await Promise.all(
      Object.entries(newUploadingAssets).map(async ([uploadId, uploadAsset]) => {
        const result = await uploadFile(uploadAsset.file, uploadId);
        return { uploadId, result, file: uploadAsset.file };
      }),
    );

    // 성공한 업로드만 필터링
    const successfulUploads = uploadResults.filter(({ result }) => result && result.url);

    // 이미지 업로드만 필터링
    const imageUploads = successfulUploads.filter(
      ({ result }) =>
        result?.fileExt && ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(result.fileExt.toLowerCase()),
    );

    // 이미지 설명 한번에 가져오기
    const imageDescriptions: Record<string, string> = {};

    if (imageUploads.length > 0) {
      try {
        console.log(`Fetching descriptions for ${imageUploads.length} images...`);

        const imageUrls = imageUploads.map(({ result }) => result?.url).filter(Boolean);

        const descriptionResponse = await fetch('/api/image-description', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageUrls,
          }),
        });

        if (descriptionResponse.ok) {
          const descriptions = await descriptionResponse.json();

          if (Array.isArray(descriptions) && descriptions.length > 0) {
            // URL을 키로 해서 설명을 매핑
            descriptions.forEach((desc, index) => {
              const url = imageUrls[index];

              if (url && desc.features) {
                imageDescriptions[url] = desc.features;
              }
            });
          }
        }
      } catch (descError) {
        console.error('Error fetching image descriptions:', descError);
      }
    }

    // URL 정보 업데이트
    const finalCategories = { ...categoriesRef.current };
    let hasChanges = false;

    // 디버깅을 위한 로그 추가
    console.log(`Processing ${uploadResults.length} upload results`);
    console.log(`Current assets in category:`, Object.keys(finalCategories[selectedCategory] || {}).length);

    // 먼저 uploadId 기반으로 찾고, 없으면 파일 이름으로 찾는 방식으로 변경
    uploadResults.forEach(({ uploadId, result, file }) => {
      if (result && result.url) {
        console.log(`Processing upload result for ${uploadId}, file: ${file.name}, URL: ${result.url}`);

        let found = false;

        // 각 카테고리의 각 에셋을 확인해서 uploadId로 매칭
        Object.entries(finalCategories[selectedCategory]).forEach(([key, asset]) => {
          if (asset.metadata?.uploadId === uploadId) {
            found = true;

            // 이 이미지에 대한 설명 찾기
            const description = imageDescriptions[result.url] || file.name;

            // URL 업데이트, description 추가
            finalCategories[selectedCategory][key] = {
              ...asset,
              url: result.url, // 확실하게 URL 설정
              description, // 일괄 조회된 description 설정
              metadata: {
                ...asset.metadata,
                ...(result.dimensions ? result.dimensions : {}),
                uploadComplete: true, // 업로드 완료 표시
              },
            };

            console.log(`Updated asset ${key} with URL: ${result.url} and description: "${description}"`);
            hasChanges = true;
          }
        });

        // uploadId로 찾지 못했다면 파일 이름으로 매칭 시도
        if (!found) {
          console.log(`No asset found with uploadId ${uploadId}, trying to match by filename: ${file.name}`);

          Object.entries(finalCategories[selectedCategory]).forEach(([key, asset]) => {
            // 파일 이름이나 설명으로 매칭 시도
            if (
              asset.description === file.name ||
              asset.metadata?.originalName === file.name ||
              getFileNameFromUrl(asset.url) === file.name
            ) {
              found = true;

              // 이 이미지에 대한 설명 찾기
              const description = imageDescriptions[result.url] || file.name;

              // 에셋 업데이트
              finalCategories[selectedCategory][key] = {
                ...asset,
                url: result.url,
                description,
                metadata: {
                  ...asset.metadata,
                  uploadId, // 나중에 찾기 쉽도록 uploadId 추가
                  ...(result.dimensions ? result.dimensions : {}),
                  uploadComplete: true,
                },
              };

              console.log(`Matched asset by filename: ${key} with URL: ${result.url}`);
              hasChanges = true;
            }
          });
        }

        // 그래도 찾지 못했다면 새 에셋으로 추가
        if (!found) {
          console.log(`No matching asset found for ${file.name}, creating new asset entry`);

          const newKey = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${file.name.replace(/\.[^/.]+$/, '')}`;
          const description = imageDescriptions[result.url] || file.name;

          finalCategories[selectedCategory][newKey] = {
            url: result.url,
            description,
            metadata: {
              uploadId,
              originalName: file.name,
              uploadComplete: true,
              dimensions: result.dimensions || {},
            },
          };

          console.log(`Created new asset ${newKey} with URL: ${result.url}`);
          hasChanges = true;
        }
      } else {
        // 실패한 업로드 처리
        Object.entries(finalCategories[selectedCategory]).forEach(([key, asset]) => {
          if (asset.metadata?.uploadId === uploadId) {
            // 에러 표시로 업데이트
            finalCategories[selectedCategory][key] = {
              ...asset,
              metadata: {
                ...asset.metadata,
                error: true,
                errorMessage: 'Upload failed',
              },
            };
            hasChanges = true;
          }
        });
      }
    });

    if (hasChanges) {
      // 최종 상태 업데이트 - 동기화
      categoriesRef.current = finalCategories;
      setCategories(finalCategories);

      // 업로드 성공 후 assets.json 저장
      await saveAssets();
    } else {
      console.warn('No assets were updated after processing uploads');
    }

    const successCount = uploadResults.filter(({ result }) => result && result.url).length;
    const failCount = uploadResults.length - successCount;

    if (failCount > 0) {
      toast.warning(`Failed to upload ${failCount} file${failCount !== 1 ? 's' : ''}`);
    }

    // End uploading process
    setIsUploading(false);

    return successCount > 0;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!selectedCategory) {
      toast.error('Please select a category before uploading');
      return;
    }

    // 에셋 드래그인지 확인
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));

      if (data.type === 'assets') {
        // 에셋 드래그이므로 함수 종료
        return;
      }
    } catch {
      // 파싱 에러는 무시 (일반 파일 드롭인 경우)
    }

    // 드롭된 파일 처리
    const { files: droppedFiles } = e.dataTransfer;
    await processFiles(Array.from(droppedFiles));
  };

  // 파일 선택 입력을 위한 ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 파일 선택 클릭 핸들러
  const handleFileSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // 파일 선택 변경 핸들러
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { files: selectedFiles } = e.target;

    if (!selectedFiles || selectedFiles.length === 0) {
      return;
    }

    await processFiles(Array.from(selectedFiles));

    // 파일 입력 필드 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 업로드 버튼 컴포넌트
  const UploadButton = () => (
    <div className="ml-2">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileChange}
        multiple
        accept={allowedFileExtensions.join(',')}
      />
      <PanelHeaderButton onClick={handleFileSelect} disabled={isUploading || !selectedCategory}>
        <div className="i-ph:upload-simple-duotone mr-1" />
        Upload Assets
      </PanelHeaderButton>
    </div>
  );

  // 에셋 카드 렌더링 함수 추가 (플레이스홀더와 일반 에셋 구분)
  const renderAssetCard = (assetKey: string, asset: Asset) => {
    const previewUrl = getPreviewUrl(asset);
    const assetType = getAssetType(asset);
    const isPlaceholder = asset.metadata?.isPlaceholder;
    const hasError = asset.metadata?.error;
    const uploadId = asset.metadata?.uploadId;
    const uploadInfo = uploadId ? uploadingAssets[uploadId] : null;
    const isUploadComplete = uploadInfo?.status === 'success' || asset.metadata?.uploadComplete;
    const isSelected = selectedAssets.has(assetKey);

    // 드래그 가능 여부 - 선택된 에셋만 드래그 가능
    const isDraggable = isSelected && !isPlaceholder;

    return (
      <div
        key={assetKey}
        className={`
          border rounded p-2 cursor-pointer select-none
          ${
            isSelected
              ? 'border-bolt-elements-item-borderActive bg-bolt-elements-item-backgroundActive'
              : isPlaceholder
                ? hasError
                  ? 'border-red-500/30 bg-red-500/10'
                  : isUploadComplete
                    ? 'border-green-500/30 bg-green-500/10'
                    : 'border-bolt-elements-borderColor/50 bg-bolt-elements-bgActive/10'
                : 'border-bolt-elements-borderColor'
          }
          hover:bg-bolt-elements-hoverColor transition-colors
        `}
        onClick={(e) => {
          // 이벤트 전파 중지
          e.stopPropagation();

          if (!isPlaceholder || isUploadComplete) {
            handleAssetSelect(assetKey, asset, e.shiftKey);
          }
        }}
        draggable={isDraggable}
        onDragStart={(e) => isDraggable && handleAssetDragStart(e, assetKey, asset)}
        onDragEnd={handleAssetDragEnd}
      >
        <div className="aspect-video bg-bolt-elements-bgSecondary rounded flex items-center justify-center mb-2 overflow-hidden relative">
          {isSelected && !isPlaceholder && (
            <div className="absolute top-2 right-2 z-10">
              <div className="i-ph:check-circle-fill text-green-500 text-xl"></div>
            </div>
          )}
          {isPlaceholder ? (
            <div className="absolute inset-0 flex items-center justify-center">
              {hasError ? (
                <div className="text-center text-red-500">
                  <div className="i-ph:warning-bold text-4xl opacity-70 mx-auto mb-1" />
                  <div className="text-xs">Upload Failed</div>
                </div>
              ) : isUploadComplete ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center text-green-500">
                    <div className="i-ph:check-circle-bold text-4xl opacity-70 mx-auto mb-1" />
                    <div className="text-xs">Upload Complete</div>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-3/4">
                    <div className="text-center mb-2">
                      <div className="i-ph:cloud-arrow-up-duotone text-3xl opacity-70 mx-auto" />
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${uploadInfo?.progress || 0}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-center mt-1">{uploadInfo?.progress || 0}%</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={asset.description}
                  className="max-w-full max-h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.src = '';
                    e.currentTarget.classList.add('hidden');
                  }}
                />
              ) : assetType === '3d' && asset.url ? (
                <div className="w-full h-full">
                  <ModelViewer url={asset.url} width="100%" height="100%" />
                </div>
              ) : assetType === '3d' ? (
                <div className="text-center">
                  <div className="i-ph:cube-duotone text-4xl opacity-70 mx-auto mb-1 text-bolt-elements-textHighlight" />
                  <div className="text-xs text-bolt-elements-textSecondary">3D Model</div>
                </div>
              ) : assetType === 'audio' ? (
                <div className="text-center">
                  <div className="i-ph:speaker-high-duotone text-4xl opacity-70 mx-auto mb-1 text-bolt-elements-textHighlight" />
                  <div className="text-xs text-bolt-elements-textSecondary">Audio</div>
                </div>
              ) : assetType === 'video' ? (
                <div className="text-center">
                  <div className="i-ph:video-duotone text-4xl opacity-70 mx-auto mb-1 text-bolt-elements-textHighlight" />
                  <div className="text-xs text-bolt-elements-textSecondary">Video</div>
                </div>
              ) : (
                <div className="i-ph:link-duotone text-3xl opacity-30" />
              )}
            </>
          )}
        </div>

        <div
          className={`
          truncate text-sm font-medium
          ${
            isPlaceholder
              ? isUploadComplete
                ? 'text-green-500'
                : 'text-bolt-elements-textSecondary/70'
              : selectedAsset?.key === assetKey
                ? 'text-bolt-elements-item-contentActive'
                : 'text-bolt-elements-textPrimary'
          }
        `}
        >
          {isPlaceholder
            ? isUploadComplete
              ? `Completed: ${asset.description}`
              : `Uploading: ${asset.description}`
            : getFileNameFromUrl(asset.url) || assetKey}
        </div>

        <div className="truncate text-xs text-bolt-elements-textSecondary">
          {isPlaceholder
            ? hasError
              ? 'Upload failed'
              : isUploadComplete
                ? 'Click to view details'
                : 'Uploading...'
            : asset.description}
        </div>
      </div>
    );
  };

  // 에셋 목록 렌더링 부분 수정
  const renderAssetGrid = () => {
    if (isLoading) {
      return (
        <div className="text-center p-4">
          <div className="i-ph:spinner-gap animate-spin text-3xl mx-auto mb-2"></div>
          <div>Loading...</div>
        </div>
      );
    }

    if (!selectedCategory) {
      return <div className="text-center text-bolt-elements-textSecondary p-4">Select a category to view assets</div>;
    }

    const categoryAssets = categories[selectedCategory] || {};
    const hasAssets = Object.keys(categoryAssets).length > 0;

    // 에셋 선택 해제 핸들러
    const handleBackgroundClick = (e: React.MouseEvent) => {
      // 이벤트 타겟이 그리드 컨테이너 자체인 경우에만 실행
      if (e.target === e.currentTarget) {
        setSelectedAssets(new Set());
        setSelectedAsset(null);
        setEditedAsset(null);
      }
    };

    if (!hasAssets) {
      return (
        <div className="text-center text-bolt-elements-textSecondary relative p-8" onClick={handleBackgroundClick}>
          <div className="mb-4">No assets in this category</div>
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-bolt-elements-bgActive/20 rounded-lg border-2 border-dashed border-bolt-elements-borderActive">
              <div className="text-center">
                <div className="i-ph:upload-simple-duotone text-4xl mb-2"></div>
                <div>Drop files to upload</div>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 relative" onClick={handleBackgroundClick}>
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-bolt-elements-bgActive/20 rounded-lg border-2 border-dashed border-bolt-elements-borderActive z-10">
            <div className="text-center">
              <div className="i-ph:upload-simple-duotone text-4xl mb-2"></div>
              <div>Drop files to upload</div>
            </div>
          </div>
        )}

        {Object.entries(categoryAssets).map(([assetKey, asset]) => renderAssetCard(assetKey, asset))}
      </div>
    );
  };

  // useEffect for successful uploads 수정
  useEffect(() => {
    const timer = setTimeout(() => {
      const hasSuccessfulUploads = Object.keys(successfulUploads).length > 0;

      if (hasSuccessfulUploads && selectedCategory) {
        console.log('Processing successful uploads:', successfulUploads);

        // 최신 카테고리 상태 가져오기
        const updatedCategories = { ...categoriesRef.current };

        if (!updatedCategories[selectedCategory]) {
          return;
        }

        let hasChanges = false;

        // 모든 에셋을 확인하여 완료된 플레이스홀더를 변환
        Object.entries(updatedCategories[selectedCategory]).forEach(([key, asset]) => {
          if (asset.metadata?.isPlaceholder && asset.metadata?.uploadId && successfulUploads[asset.metadata.uploadId]) {
            console.log(`Converting placeholder to asset for key ${key}, URL: ${asset.url}`);

            // URL이 비어 있는지 확인
            if (!asset.url) {
              console.warn(`Asset URL is empty for key ${key} with uploadId ${asset.metadata.uploadId}`);

              // URL 재생성 시도
              if (asset.metadata.originalName && verse) {
                asset.url = `https://agent8-games.verse8.io/${verse}/assets/${selectedCategory}/${asset.metadata.originalName}`;
                console.log(`Generated URL for asset: ${asset.url}`);
              }
            }

            // 플레이스홀더를 정식 에셋으로 변환
            const dimensions = asset.metadata.dimensions;

            updatedCategories[selectedCategory][key] = {
              url: asset.url, // 기존 URL 유지
              description: asset.description,
              metadata: {
                originalName: asset.metadata.originalName,
                size: asset.metadata.size,
                type: asset.metadata.type,
                uploadedAt: asset.metadata.uploadedAt,
                ...(dimensions ? dimensions : {}),
              },
            };

            console.log(`Finalized asset ${key} with URL: ${asset.url}`); // 디버깅 로그 추가
            hasChanges = true;
          }
        });

        if (hasChanges) {
          // 상태와 ref 모두 업데이트
          console.log('Updating categories with finalized assets');
          categoriesRef.current = updatedCategories;
          setCategories(updatedCategories);

          // 변경사항 저장
          saveAssets();

          // 성공 업로드 기록 초기화
          setSuccessfulUploads({});
        }
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [successfulUploads, selectedCategory, verse]);

  // 에셋 드래그 시작 처리를 위한 함수 추가
  const handleAssetDragStart = (e: React.DragEvent, assetKey: string, asset: Asset) => {
    e.stopPropagation();

    // 드래그 중인 에셋 정보 설정
    if (selectedAssets.has(assetKey)) {
      // 선택된 여러 에셋을 드래그하는 경우
      const assetsToMove = Array.from(selectedAssets);
      e.dataTransfer.setData(
        'text/plain',
        JSON.stringify({
          type: 'assets',
          sourceCategory: selectedCategory,
          assetKeys: assetsToMove,
        }),
      );
      setDraggedAssets(assetsToMove);
    } else {
      // 단일 에셋만 드래그하는 경우 (선택되지 않은 에셋)
      e.dataTransfer.setData(
        'text/plain',
        JSON.stringify({
          type: 'assets',
          sourceCategory: selectedCategory,
          assetKeys: [assetKey],
        }),
      );
      setDraggedAssets([assetKey]);
    }

    // 드래그 이미지 설정 (선택적)
    const dragIcon = document.createElement('div');
    dragIcon.className = 'bg-bolt-elements-backgroundActive p-2 rounded text-white text-xs';
    dragIcon.textContent =
      selectedAssets.has(assetKey) && selectedAssets.size > 1
        ? `${selectedAssets.size} assets`
        : getFileNameFromUrl(asset.url) || assetKey;
    document.body.appendChild(dragIcon);
    e.dataTransfer.setDragImage(dragIcon, 0, 0);
    setTimeout(() => document.body.removeChild(dragIcon), 0);

    setIsDraggingAssets(true);
  };

  // 드래그 종료 처리 함수
  const handleAssetDragEnd = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDraggingAssets(false);
    setDraggedAssets([]);
    setHoveredCategory(null);
  };

  // 카테고리에 에셋 드롭 처리 함수 추가
  const handleCategoryDrop = async (e: React.DragEvent, targetCategory: string) => {
    e.preventDefault();
    e.stopPropagation();

    // hover 상태 초기화
    setHoveredCategory(null);

    // 파일 업로드 드롭과 에셋 이동 드롭을 구분
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));

      if (data.type === 'assets' && data.sourceCategory && Array.isArray(data.assetKeys)) {
        const sourceCategory = data.sourceCategory;
        const assetKeys = data.assetKeys;

        // 소스 카테고리와 타겟 카테고리가 같으면 이동하지 않음
        if (sourceCategory === targetCategory) {
          return;
        }

        // 카테고리 간 에셋 이동 처리
        const updatedCategories = { ...categoriesRef.current };
        let movedCount = 0;

        assetKeys.forEach((assetKey: string) => {
          if (updatedCategories[sourceCategory] && updatedCategories[sourceCategory][assetKey]) {
            const asset = updatedCategories[sourceCategory][assetKey];

            // 타겟 카테고리에 에셋 추가
            if (!updatedCategories[targetCategory]) {
              updatedCategories[targetCategory] = {};
            }

            // 중복 방지를 위해 새 키 생성
            const newAssetKey = `asset_${Date.now()}_${movedCount}_${assetKey.split('_').pop()}`;
            updatedCategories[targetCategory][newAssetKey] = { ...asset };

            // 소스 카테고리에서 에셋 제거
            delete updatedCategories[sourceCategory][assetKey];
            movedCount++;
          }
        });

        // 상태 업데이트
        categoriesRef.current = updatedCategories;
        setCategories(updatedCategories);

        // 선택된 에셋 초기화
        setSelectedAsset(null);
        setEditedAsset(null);
        setSelectedAssets(new Set());

        // 변경사항 저장
        await saveAssets();
      }
    } catch {
      // 파싱 에러는 무시 (일반 파일 드롭인 경우)
      console.log('Not an asset drag operation');
    }
  };

  // 이미지 차원 가져오는 헬퍼 함수 추가
  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        resolve({
          width: img.width,
          height: img.height,
        });
        URL.revokeObjectURL(img.src); // 메모리 누수 방지를 위한 정리
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={20} minSize={15} maxSize={30}>
        <div className="flex flex-col h-full border-r border-bolt-elements-borderColor">
          <PanelHeader>
            <div className="i-ph:folders-duotone shrink-0" />
            Resources
            <div className="ml-auto">
              <PanelHeaderButton onClick={handleAddCategory}>
                <div className="i-ph:plus-circle-duotone" />
              </PanelHeaderButton>
            </div>
          </PanelHeader>
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="p-4 text-center">Loading...</div>
            ) : (
              <ul className="p-2">
                {Object.keys(categories).map((category) => (
                  <li
                    key={category}
                    className={`
                      p-2 mb-1 rounded cursor-pointer flex items-center
                      ${
                        selectedCategory === category
                          ? 'bg-bolt-elements-item-backgroundActive text-bolt-elements-item-contentActive'
                          : isDraggingAssets && hoveredCategory === category
                            ? 'text-bolt-elements-textPrimary bg-bolt-elements-bgActive/50'
                            : 'text-bolt-elements-textPrimary hover:bg-bolt-elements-hoverColor'
                      }
                      transition-colors duration-100
                    `}
                    onClick={() => handleCategorySelect(category)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();

                      if (isDraggingAssets) {
                        setHoveredCategory(category);
                      }
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();

                      if (isDraggingAssets) {
                        setHoveredCategory(category);
                      }
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();

                      if (hoveredCategory === category) {
                        setHoveredCategory(null);
                      }
                    }}
                    onDrop={(e) => {
                      handleCategoryDrop(e, category);
                      setHoveredCategory(null);
                    }}
                  >
                    <div
                      className={`
                      mr-2 
                      ${selectedCategory === category ? 'i-ph:folder-open-duotone' : 'i-ph:folder-duotone'}
                    `}
                    />
                    {category}
                    <span
                      className={`
                      ml-auto text-xs 
                      ${selectedCategory === category ? 'text-bolt-elements-textHighlight' : 'text-bolt-elements-textSecondary'}
                    `}
                    >
                      {Object.keys(categories[category] || {}).length}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selectedCategory && (
            <div className="p-2 border-t border-bolt-elements-borderColor">
              <Button className="w-full justify-center" onClick={handleDeleteCategory} variant="destructive" size="sm">
                Delete Category
              </Button>
            </div>
          )}
        </div>
      </Panel>

      <PanelResizeHandle />

      <Panel defaultSize={40} minSize={20}>
        <div className="flex flex-col h-full border-r border-bolt-elements-borderColor">
          <PanelHeader>
            <div className="i-ph:image-duotone shrink-0" />
            {selectedCategory ? `${selectedCategory} Assets` : 'Assets'}
            {selectedCategory && (
              <div className="ml-auto flex">
                {selectedAssets.size > 0 && (
                  <PanelHeaderButton onClick={handleDeleteSelectedAssets} className="text-red-400 hover:text-red-300">
                    <div className="i-ph:trash-duotone" />
                    Delete {selectedAssets.size > 1 ? `${selectedAssets.size} Assets` : 'Asset'}
                  </PanelHeaderButton>
                )}
                <UploadButton />
              </div>
            )}
          </PanelHeader>
          <div
            className={`flex-1 overflow-auto ${isDragging ? 'bg-bolt-elements-bgActive/10' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {renderAssetGrid()}
          </div>
        </div>
      </Panel>

      <PanelResizeHandle />

      <Panel defaultSize={40} minSize={30}>
        <div className="flex flex-col h-full">
          <PanelHeader>
            <div className="i-ph:pencil-duotone shrink-0" />
            {selectedAsset ? 'Edit Asset' : 'Asset Details'}
            {selectedAsset && editedAsset && (
              <div className="ml-auto flex gap-1">
                <PanelHeaderButton onClick={handleAssetUpdate} disabled={isSaving}>
                  <div className="i-ph:floppy-disk-duotone" />
                  Save
                </PanelHeaderButton>
              </div>
            )}
          </PanelHeader>

          <div className="flex-1 overflow-auto p-4">
            {!selectedAsset || !editedAsset ? (
              <div className="text-center text-bolt-elements-textSecondary">Select an asset to edit</div>
            ) : (
              <div className="space-y-4 text-bolt-elements-textPrimary">
                <div className="bg-bolt-elements-bgSecondary rounded-lg p-4 flex items-center justify-center">
                  {getPreviewUrl(editedAsset) ? (
                    <img
                      src={getPreviewUrl(editedAsset) || ''}
                      alt={editedAsset.description}
                      className="max-w-full max-h-48 object-contain"
                    />
                  ) : getAssetType(editedAsset) === '3d' && editedAsset.url ? (
                    <div className="w-full h-48">
                      <ModelViewer url={editedAsset.url} height="100%" width="100%" />
                    </div>
                  ) : getAssetType(editedAsset) === '3d' ? (
                    <div className="text-center">
                      <div className="i-ph:cube-duotone text-6xl opacity-70 mx-auto mb-2 text-bolt-elements-textHighlight" />
                      <div className="text-sm text-bolt-elements-textSecondary">3D Model (.glb)</div>
                    </div>
                  ) : getAssetType(editedAsset) === 'audio' ? (
                    <div className="text-center">
                      <div className="i-ph:speaker-high-duotone text-6xl opacity-70 mx-auto mb-2 text-bolt-elements-textHighlight" />
                      <div className="text-sm text-bolt-elements-textSecondary">Audio File</div>
                    </div>
                  ) : getAssetType(editedAsset) === 'video' ? (
                    <div className="text-center">
                      <div className="i-ph:video-duotone text-6xl opacity-70 mx-auto mb-2 text-bolt-elements-textHighlight" />
                      <div className="text-sm text-bolt-elements-textSecondary">Video File</div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="i-ph:link-duotone text-5xl opacity-30 mx-auto mb-2" />
                      <div className="text-sm text-bolt-elements-textSecondary">No preview available</div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-bolt-elements-textPrimary">Asset Key</label>
                  <Input value={selectedAsset.key} readOnly className="w-full  bg-gray-700 border-gray-600" />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-bolt-elements-textPrimary">URL</label>
                  <Input
                    value={editedAsset.url}
                    onChange={(e) => handleAssetChange('url', e.target.value)}
                    className="w-full bg-gray-700 border-gray-600"
                    placeholder="Enter asset URL"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-bolt-elements-textPrimary">Description</label>
                  <Input
                    value={editedAsset.description}
                    onChange={(e) => handleAssetChange('description', e.target.value)}
                    className="w-full bg-gray-700 border-gray-600"
                    placeholder="Enter asset description"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-bolt-elements-textPrimary">
                    Metadata (JSON)
                  </label>
                  <Input
                    value={JSON.stringify(editedAsset.metadata, null, 2)}
                    onChange={(e) => handleAssetChange('metadata', e.target.value)}
                    className="w-full bg-gray-700 border-gray-600 font-mono text-sm"
                    placeholder="{}"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </PanelGroup>
  );
});
