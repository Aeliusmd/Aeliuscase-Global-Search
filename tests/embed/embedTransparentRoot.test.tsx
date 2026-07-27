import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import EmbedTransparentRoot from '@/components/embed/EmbedTransparentRoot';

describe('EmbedTransparentRoot', () => {
  it('adds embed-transparent class to html and removes on unmount', async () => {
    const { unmount } = render(
      <EmbedTransparentRoot>
        <div data-testid="child">embed</div>
      </EmbedTransparentRoot>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('embed-transparent')).toBe(true);
    });

    unmount();

    expect(document.documentElement.classList.contains('embed-transparent')).toBe(false);
  });
});
