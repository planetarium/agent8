import { openai } from '@ai-sdk/openai';
import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData, useSearchParams, useFetcher } from '@remix-run/react';
import { createClient } from '@supabase/supabase-js';
import { embed } from 'ai';
import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { ClientOnly } from 'remix-utils/client-only';

// 페이지당 항목 수
const ITEMS_PER_PAGE = 20;

// 레코드 타입 정의
interface Record {
  id: string;
  client_code?: string;
  server_code?: string;
  description?: string;
  metadata: {
    category?: string;
  };
  created_at: string;
}

// 로더 함수: 데이터 조회 및 페이징 처리
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const searchQuery = url.searchParams.get('query') || '';
  const searchMode = url.searchParams.get('mode') || 'match';
  const from = (page - 1) * ITEMS_PER_PAGE;
  const to = from + ITEMS_PER_PAGE - 1;

  let data: any[] = [];
  let count = 0;
  let error = null;

  try {
    if (searchMode === 'similarity' && searchQuery) {
      const { embedding } = await embed({
        model: openai.embedding('text-embedding-ada-002'),
        value: searchQuery,
      });

      const { data: similarityData, error: similarityError } = await supabase.rpc('match_codebase', {
        query_embedding: embedding,
        match_count: 10,
        filter: {},
      });

      console.log(similarityData);

      if (similarityError) {
        throw similarityError;
      }

      data = similarityData || [];
      count = data.length;
    } else {
      // 일반 검색 또는 전체 목록
      let query = supabase
        .from('codebase')
        .select('id, server_code, client_code, description, metadata, created_at', { count: 'exact' });

      // 검색어가 있으면 description에서 매칭
      if (searchQuery && searchMode === 'match') {
        query = query.ilike('description', `%${searchQuery}%`);
      }

      // 전체 개수 조회
      const { data: countResult, error: countError } = await supabase
        .from('codebase')
        .select('count', { count: 'exact', head: true });

      if (countError) {
        throw countError;
      }

      const totalCount = countResult?.[0]?.count || 0;

      count = totalCount || 0;

      // 페이지에 해당하는 레코드 조회
      const { data: pageData, error: dataError } = await query.order('id', { ascending: false }).range(from, to);

      if (dataError) {
        throw dataError;
      }

      data = pageData || [];
    }
  } catch (e: any) {
    error = e.message;
    data = [];
  }

  const totalPages = Math.ceil(count / ITEMS_PER_PAGE);

  return json({
    records: data,
    totalPages,
    currentPage: page,
    searchQuery,
    searchMode,
    error,
  });
}

// ThemedContent 컴포넌트 Props 타입 정의
interface ThemedContentProps {
  records: Record[];
  totalPages: number;
  currentPage: number;
  searchQuery: string;
  searchMode: string;
  clientCode: string;
  setClientCode: (code: string) => void;
  serverCode: string;
  setServerCode: (code: string) => void;
  description: string;
  setDescription: (description: string) => void;
  category: string;
  setCategory: (category: string) => void;
  isSubmitting: boolean;
  handleInsert: (e: React.FormEvent) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  handlePageChange: (page: number) => void;
  handleSearch: (e: React.FormEvent) => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: string) => void;
  refreshData: () => void;
}

// 테마 스타일을 적용하는 컴포넌트
function ThemedContent({
  records,
  totalPages,
  currentPage,
  searchQuery,
  searchMode,
  clientCode,
  setClientCode,
  serverCode,
  setServerCode,
  description,
  setDescription,
  category,
  setCategory,
  isSubmitting,
  handleInsert,
  handleDelete,
  handlePageChange,
  handleSearch,
  setSearchQuery,
  setSearchMode,
  refreshData,
}: ThemedContentProps) {
  const isDarkMode = true;
  const styles = {
    bgClass: isDarkMode ? 'bg-gray-800' : 'bg-bolt-elements-prompt-background',
    textClass: isDarkMode ? 'text-white' : 'text-bolt-elements-textPrimary',
    borderClass: 'border-bolt-elements-borderColor',
    inputBgClass: isDarkMode ? 'bg-gray-700' : 'bg-bolt-elements-prompt-background',
    pageBgClass: isDarkMode ? 'bg-gray-900' : 'bg-white',
  };

  return (
    <>
      {/* 레코드 삽입 폼 */}
      <div className={`${styles.bgClass} p-4 rounded-lg mb-8 border ${styles.borderClass}`}>
        <h2 className={`text-xl font-semibold mb-4 ${styles.textClass}`}>Insert New Record</h2>
        <form onSubmit={handleInsert}>
          <div className="mb-4">
            <label className={`block text-sm font-medium mb-1 ${styles.textClass}`}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`w-full p-2 border ${styles.borderClass} rounded ${styles.inputBgClass} ${styles.textClass}`}
            >
              <option value="code">Code</option>
              <option value="text">Text</option>
              <option value="documentation">Documentation</option>
            </select>
          </div>
          <div className="mb-4">
            <label className={`block text-sm font-medium mb-1 ${styles.textClass}`}>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the content"
              className={`w-full p-2 border ${styles.borderClass} rounded ${styles.inputBgClass} ${styles.textClass}`}
              required
            />
          </div>
          <div className="mb-4">
            <label className={`block text-sm font-medium mb-1 ${styles.textClass}`}>Client Code</label>
            <textarea
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
              placeholder="Enter client-side code here"
              className={`w-full p-2 border ${styles.borderClass} rounded ${styles.inputBgClass} h-32 ${styles.textClass}`}
            />
          </div>
          <div className="mb-4">
            <label className={`block text-sm font-medium mb-1 ${styles.textClass}`}>Server Code</label>
            <textarea
              value={serverCode}
              onChange={(e) => setServerCode(e.target.value)}
              placeholder="Enter server-side code here"
              className={`w-full p-2 border ${styles.borderClass} rounded ${styles.inputBgClass} h-32 ${styles.textClass}`}
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting || (!clientCode && !serverCode)}
            className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded disabled:opacity-50"
          >
            {isSubmitting ? 'Inserting...' : 'Insert Record'}
          </button>
        </form>
      </div>

      {/* 검색 폼 */}
      <div className={`${styles.bgClass} p-4 rounded-lg mb-8 border ${styles.borderClass}`}>
        <h2 className={`text-xl font-semibold mb-4 ${styles.textClass}`}>Search Records</h2>
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-end">
          <div className="flex-grow">
            <label className={`block text-sm font-medium mb-1 ${styles.textClass}`}>Search Query</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter search terms"
              className={`w-full p-2 border ${styles.borderClass} rounded ${styles.inputBgClass} ${styles.textClass}`}
            />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1 ${styles.textClass}`}>Search Mode</label>
            <select
              value={searchMode}
              onChange={(e) => setSearchMode(e.target.value)}
              className={`p-2 border ${styles.borderClass} rounded ${styles.inputBgClass} ${styles.textClass}`}
            >
              <option value="match">Keyword Match</option>
              <option value="similarity">Similarity Search</option>
            </select>
          </div>
          <div>
            <button type="submit" className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded">
              Search
            </button>
          </div>
          <div>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchMode('match');
                refreshData();
              }}
              className="bg-gray-500 hover:bg-gray-600 text-white py-2 px-4 rounded"
            >
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* 레코드 목록 */}
      <div className={`${styles.bgClass} p-4 rounded-lg border ${styles.borderClass}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className={`text-xl font-semibold ${styles.textClass}`}>
            Records{' '}
            {searchQuery &&
              `- Search: "${searchQuery}" (${searchMode === 'match' ? 'Keyword Match' : 'Similarity Search'})`}
          </h2>
          <button
            onClick={refreshData}
            className="bg-green-500 hover:bg-green-600 text-white py-1 px-3 rounded text-sm"
          >
            Refresh
          </button>
        </div>

        {records.length === 0 ? (
          <p className={`text-center py-4 ${styles.textClass}`}>No records found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`min-w-full ${styles.textClass}`}>
              <thead>
                <tr className={`border-b ${styles.borderClass}`}>
                  <th className="px-4 py-2 text-left">ID</th>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-left">Client Code</th>
                  <th className="px-4 py-2 text-left">Server Code</th>
                  <th className="px-4 py-2 text-left">Category</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className={`border-b ${styles.borderClass}`}>
                    <td className="px-4 py-2">{record.id}</td>
                    <td className="px-4 py-2">
                      <div className="max-w-xs overflow-hidden text-ellipsis">
                        {record.description || 'No description'}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="max-w-md overflow-hidden text-ellipsis">
                        {record.client_code && record.client_code.length > 50
                          ? `${record.client_code.substring(0, 50)}...`
                          : record.client_code || 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="max-w-md overflow-hidden text-ellipsis">
                        {record.server_code && record.server_code.length > 50
                          ? `${record.server_code.substring(0, 50)}...`
                          : record.server_code || 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-2">{record.metadata?.category || 'N/A'}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleDelete(record.id)}
                        className="bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded text-sm"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex justify-center mt-6">
            <nav className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className={`px-3 py-1 rounded border ${styles.borderClass} disabled:opacity-50 ${styles.textClass}`}
              >
                &laquo; Prev
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => handlePageChange(page)}
                  className={`px-3 py-1 rounded ${
                    currentPage === page ? 'bg-blue-500 text-white' : `border ${styles.borderClass} ${styles.textClass}`
                  }`}
                >
                  {page}
                </button>
              ))}

              <button
                onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className={`px-3 py-1 rounded border ${styles.borderClass} disabled:opacity-50 ${styles.textClass}`}
              >
                Next &raquo;
              </button>
            </nav>
          </div>
        )}
      </div>
    </>
  );
}

export default function vectorDBManager() {
  const {
    records,
    totalPages,
    currentPage,
    searchQuery: initialSearchQuery,
    searchMode: initialSearchMode,
    error,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<{
    records: Record[];
    totalPages: number;
    currentPage: number;
    searchQuery: string;
    searchMode: string;
    error: string | null;
  }>();
  const isDarkMode = true;

  const [clientCode, setClientCode] = useState('');
  const [serverCode, setServerCode] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('code');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [searchMode, setSearchMode] = useState(initialSearchMode || 'match');

  // 페이지 로드 시 테마 설정
  useEffect(() => {
    // 페이지 배경색 설정
    document.body.classList.add(isDarkMode ? 'bg-gray-900' : 'bg-white');

    return () => {
      // 컴포넌트 언마운트 시 클래스 제거
      document.body.classList.remove('bg-gray-900', 'bg-white');
    };
  }, [isDarkMode]);

  // 페이지 변경 핸들러
  const handlePageChange = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('page', newPage.toString());
    setSearchParams(newParams);
  };

  // 검색 핸들러
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();

    const newParams = new URLSearchParams();
    newParams.set('page', '1'); // 검색 시 첫 페이지로 이동

    if (searchQuery) {
      newParams.set('query', searchQuery);
    }

    newParams.set('mode', searchMode);
    setSearchParams(newParams);
  };

  // 데이터 새로고침 함수
  const refreshData = () => {
    // 현재 검색 조건으로 데이터를 다시 로드
    const queryString = searchParams.toString();
    fetcher.load(`/vector-db${queryString ? `?${queryString}` : ''}`);
  };

  // 레코드 삽입 핸들러
  const handleInsert = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!description) {
      toast.error('Description is required');
      return;
    }

    if (!clientCode && !serverCode) {
      toast.error('At least one of Client Code or Server Code is required');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('intent', 'insert');
      formData.append('clientCode', clientCode);
      formData.append('serverCode', serverCode);
      formData.append('description', description);
      formData.append('category', category);

      const response = await fetch('/api/vector-db', {
        method: 'POST',
        body: formData,
      });

      const result = (await response.json()) as { success: boolean; error?: string };

      if (result.success) {
        toast.success('Record inserted successfully');
        setClientCode('');
        setServerCode('');
        setDescription('');

        // 데이터 새로고침
        refreshData();
      } else {
        toast.error(`Failed to insert record: ${result.error}`);
      }
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 레코드 삭제 핸들러
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) {
      return;
    }

    try {
      const formData = new FormData();
      formData.append('intent', 'delete');
      formData.append('id', id);

      const response = await fetch('/api/vector-db', {
        method: 'POST',
        body: formData,
      });

      const result = (await response.json()) as { success: boolean; error?: string };

      if (result.success) {
        toast.success('Record deleted successfully');

        // 데이터 새로고침
        refreshData();
      } else {
        toast.error(`Failed to delete record: ${result.error}`);
      }
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  return (
    <div className={`container mx-auto p-4 ${isDarkMode ? 'text-white' : 'text-bolt-elements-textPrimary'}`}>
      <h1 className="text-2xl font-bold mb-6">Vector Database Manager</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">Error: {error}</div>
      )}

      <ClientOnly>
        {() => (
          <ThemedContent
            records={(fetcher.data?.records || records) as Record[]}
            totalPages={fetcher.data?.totalPages || totalPages}
            currentPage={fetcher.data?.currentPage || currentPage}
            searchQuery={searchQuery}
            searchMode={searchMode}
            clientCode={clientCode}
            setClientCode={setClientCode}
            serverCode={serverCode}
            setServerCode={setServerCode}
            description={description}
            setDescription={setDescription}
            category={category}
            setCategory={setCategory}
            isSubmitting={isSubmitting}
            handleInsert={handleInsert}
            handleDelete={handleDelete}
            handlePageChange={handlePageChange}
            handleSearch={handleSearch}
            setSearchQuery={setSearchQuery}
            setSearchMode={setSearchMode}
            refreshData={refreshData}
          />
        )}
      </ClientOnly>
    </div>
  );
}
