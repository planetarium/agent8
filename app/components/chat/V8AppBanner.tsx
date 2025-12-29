import { classNames } from '~/utils/classNames';
import { isIOS } from 'react-device-detect';
import { APP_LINKS } from '~/constants/links';
import { AppStoreLink } from '~/components/ui/AppStoreLink';
import { GooglePlayLink } from '~/components/ui/GooglePlayLink';

interface V8AppBannerProps {
  className?: string;
}

export default function V8AppBanner({ className }: V8AppBannerProps) {
  return (
    <a
      className={classNames(
        'w-full flex items-center justify-center gap-2 md:gap-4 px-4 md:px-2 border border-tertiary bg-transparent-subtle backdrop-blur-[4px] rounded-[8px]',
        'before:content-[""] before:block before:w-[90px] before:h-[60px] before:bg-[url(/app-banner.png)] before:bg-[length:100%_100%] before:bg-no-repeat before:bg-center',
        className,
      )}
      href={isIOS && APP_LINKS.APP_STORE ? APP_LINKS.APP_STORE : APP_LINKS.GOOGLE_PLAY}
      rel="noopener noreferrer"
      target="_blank"
    >
      <div className="flex flex-col gap-1">
        <strong className="text-heading-xs bg-events-gradient bg-clip-text text-transparent">
          The Verse8 app is now live!
        </strong>
        <p className="text-body-sm text-primary">Create mobile-only games for the app</p>
      </div>
      <div className="hidden md:flex items-center gap-2">
        <AppStoreLink />
        <GooglePlayLink />
      </div>
    </a>
  );
}
