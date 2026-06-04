'use client';

import { useState, useEffect, useCallback } from 'react';
import FloatingButton from './FloatingButton';
import ChatPanel from './ChatPanel';

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);

  const handleClose = useCallback(() => setIsOpen(false), []);
  const handleToggle = useCallback(() => setIsOpen((prev) => !prev), []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleClose]);

  return (
    <>
      <FloatingButton isOpen={isOpen} onClick={handleToggle} />
      {isOpen && <ChatPanel onClose={handleClose} />}
    </>
  );
}
