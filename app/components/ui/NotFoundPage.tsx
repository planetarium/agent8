interface NotFoundPageProps {
  title?: string;
  description?: string;
  showBackButton?: boolean;
}

export function NotFoundPage({
  title = 'Project Not Found',
  description = "The project you're looking for doesn't exist or you don't have permission to access it.",
  showBackButton = true,
}: NotFoundPageProps) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-bolt-elements-background-depth-1">
      <div className="relative">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-tl from-gray-400/10 to-transparent rounded-full blur-2xl" />
        </div>

        <div className="text-center p-12 max-w-md mx-auto">
          {/* 404 Number */}
          <div className="relative mb-8">
            <div className="text-8xl font-bold text-gray-200 mb-2 drop-shadow-lg">404</div>
            <div className="absolute inset-0 text-8xl font-bold text-blue-400/30 blur-sm">404</div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-white mb-4">{title}</h1>

          {/* Description */}
          <p className="text-gray-400 mb-8 leading-relaxed">{description}</p>

          {/* Action buttons */}
          <div className="space-y-3">
            <button
              onClick={() => (window.location.href = '/')}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg 
                        transition-all duration-200 shadow-lg hover:shadow-blue-500/25 transform hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-center gap-2">
                <div className="i-ph:house text-lg" />
                Go Home
              </div>
            </button>

            {showBackButton && (
              <button
                onClick={() => window.history.back()}
                className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 
                          border border-gray-600 rounded-lg hover:border-gray-500
                          transition-all duration-200"
              >
                <div className="flex items-center justify-center gap-2">
                  <div className="i-ph:arrow-left text-lg" />
                  Go Back
                </div>
              </button>
            )}
          </div>

          {/* Additional info */}
          <div className="mt-8 p-4 bg-gray-800/50 border border-gray-700 rounded-lg backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
              <div className="i-ph:info text-lg" />
              <span>If you believe this is an error, please contact the project owner</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
