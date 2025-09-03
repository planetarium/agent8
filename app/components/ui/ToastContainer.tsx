'use client';

import { ToastContainer as ReactToastifyContainer } from 'react-toastify';
import ToastErrorIcon from '~/components/ui/Icons/ToastErrorIcon';
import ToastInfoIcon from '~/components/ui/Icons/ToastInfoIcon';
import ToastSuccessIcon from '~/components/ui/Icons/ToastSuccessIcon';
import ToastWarningIcon from '~/components/ui/Icons/ToastWarningIcon';

export default function ToastContainer() {
  return (
    <ReactToastifyContainer
      icon={({ type }) => {
        switch (type) {
          case 'info':
            return <ToastInfoIcon />;
          case 'error':
            return <ToastErrorIcon />;
          case 'success':
            return <ToastSuccessIcon />;
          case 'warning':
            return <ToastWarningIcon />;
          default:
            return null;
        }
      }}
      theme="dark"
      className="top-[70px]"
      toastClassName="bg-primary border-secondary elevation-light-2 text-heading-sm text-secondary"
    />
  );
}
