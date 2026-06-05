import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchTypeFilter from '@/components/SearchTypeFilter';
import { MainSearchType } from '@/types/case';

describe('SearchTypeFilter', () => {
  it('renders all four filter options', () => {
    render(<SearchTypeFilter value={MainSearchType.AllCases} onChange={vi.fn()} />);
    expect(screen.getByText('All Cases')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Sub-Out')).toBeInTheDocument();
  });

  it('highlights the active button', () => {
    render(<SearchTypeFilter value={MainSearchType.OpenCases} onChange={vi.fn()} />);
    const openBtn = screen.getByText('Open');
    expect(openBtn.className).toContain('bg-blue-600');
  });

  it('does not highlight inactive buttons', () => {
    render(<SearchTypeFilter value={MainSearchType.OpenCases} onChange={vi.fn()} />);
    const allBtn = screen.getByText('All Cases');
    expect(allBtn.className).not.toContain('bg-blue-600');
  });

  it('calls onChange with correct type on click', async () => {
    const onChange = vi.fn();
    render(<SearchTypeFilter value={MainSearchType.AllCases} onChange={onChange} />);
    await userEvent.click(screen.getByText('Closed'));
    expect(onChange).toHaveBeenCalledWith(MainSearchType.ClosedCases);
  });

  it('does not call onChange when disabled', async () => {
    const onChange = vi.fn();
    render(<SearchTypeFilter value={MainSearchType.AllCases} onChange={onChange} disabled />);
    await userEvent.click(screen.getByText('Open'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('buttons are disabled when disabled prop is true', () => {
    render(<SearchTypeFilter value={MainSearchType.AllCases} onChange={vi.fn()} disabled />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('applies opacity class when disabled', () => {
    render(<SearchTypeFilter value={MainSearchType.AllCases} onChange={vi.fn()} disabled />);
    const allBtn = screen.getByText('All Cases');
    expect(allBtn.className).toContain('opacity-50');
  });

  it('clicking the active button still calls onChange', async () => {
    const onChange = vi.fn();
    render(<SearchTypeFilter value={MainSearchType.AllCases} onChange={onChange} />);
    await userEvent.click(screen.getByText('All Cases'));
    expect(onChange).toHaveBeenCalledWith(MainSearchType.AllCases);
  });
});
