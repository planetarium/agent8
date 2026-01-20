interface ServiceOutagePageProps {
  title?: string;
  description?: string;
  showBackButton?: boolean;
}

export function ServiceOutagePage({
  title = 'Temporary Service Disruption',
  description = 'We are experiencing a temporary outage due to an issue with an external cloud service provider. Our team is aware and working to resolve this.',
  showBackButton = true,
}: ServiceOutagePageProps) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-bolt-elements-background-depth-1">
      <div className="relative">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-tl from-cyan-400/10 to-transparent rounded-full blur-2xl" />
        </div>

        <div className="text-center p-12 max-w-md mx-auto">
          {/* Icon */}
          <div className="relative mb-8 flex justify-center">
            <div className="w-24 h-24 rounded-full bg-purple-500/20 flex items-center justify-center">
              <div className="i-ph:cloud-warning text-5xl text-purple-400" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-white mb-4">{title}</h1>

          {/* Description */}
          <p className="text-gray-400 mb-6 leading-relaxed">{description}</p>

          {/* External service info */}
          <div className="mb-8 p-3 bg-gray-800/50 border border-gray-700 rounded-lg inline-flex items-center gap-2">
            <div className="i-ph:link text-gray-500" />
            <span className="text-gray-400 text-sm">
              Affected service:{' '}
              <a
                href="https://status.flyio.net/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 underline"
              >
                fly.io
              </a>
            </span>
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg
                        transition-all duration-200 shadow-lg hover:shadow-purple-500/25 transform hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-center gap-2">
                <div className="i-ph:arrow-clockwise text-lg" />
                Try Again
              </div>
            </button>

            {showBackButton && (
              <button
                onClick={() => (window.location.href = '/')}
                className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200
                          border border-gray-600 rounded-lg hover:border-gray-500
                          transition-all duration-200"
              >
                <div className="flex items-center justify-center gap-2">
                  <div className="i-ph:house text-lg" />
                  Go Home
                </div>
              </button>
            )}
          </div>

          {/* Additional info */}
          <div className="mt-8 p-4 bg-gray-800/50 border border-gray-700 rounded-lg backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
              <div className="i-ph:info text-lg" />
              <span>This is usually temporary. Please wait a moment and try again.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
