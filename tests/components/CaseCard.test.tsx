import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CaseCard from '@/components/CaseCard';
import type { CaseSearchItem } from '@/types/case';

const baseCase: CaseSearchItem = {
  id: 101,
  caseNumber: 'RP003782',
  fileNumber: 'F001',
  caseName: 'Smith v. Acme Corp',
  caseTypeId: 1,
  caseType: 'Workers Comp',
  caseStatusDescription: 'Open',
  caseAttorneyNickName: 'JD',
  caseCoordinatorNickName: 'CC',
  createdDateTime: '2024-03-15T00:00:00Z',
  caseApplicant: { firstName: 'Jane', lastName: 'Smith', fullName: 'Jane Smith' },
  caseEmployee: { company: 'Acme Corp' },
};

describe('CaseCard', () => {
  it('renders case number', () => {
    render(<CaseCard caseItem={baseCase} />);
    expect(screen.getByText('RP003782')).toBeInTheDocument();
  });

  it('renders case name', () => {
    render(<CaseCard caseItem={baseCase} />);
    expect(screen.getByText('Smith v. Acme Corp')).toBeInTheDocument();
  });

  it('renders applicant name from firstName + lastName', () => {
    render(<CaseCard caseItem={baseCase} />);
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('renders case type', () => {
    render(<CaseCard caseItem={baseCase} />);
    expect(screen.getByText('Workers Comp')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(<CaseCard caseItem={baseCase} />);
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('View Case link has correct href', () => {
    render(<CaseCard caseItem={baseCase} />);
    const link = screen.getByRole('link', { name: /view case RP003782/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/dashboard/case-overview/101'));
  });

  it('View Case link opens in new tab', () => {
    render(<CaseCard caseItem={baseCase} />);
    const link = screen.getByRole('link', { name: /view case/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('falls back to caseNumber when caseName is empty', () => {
    render(<CaseCard caseItem={{ ...baseCase, caseName: '' }} />);
    expect(screen.getAllByText('RP003782').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render applicant section when caseApplicant is null', () => {
    render(<CaseCard caseItem={{ ...baseCase, caseApplicant: null }} />);
    expect(screen.queryByText(/Applicant:/)).not.toBeInTheDocument();
  });

  it('uses fullName when firstName/lastName are empty', () => {
    render(
      <CaseCard
        caseItem={{
          ...baseCase,
          caseApplicant: { firstName: '', lastName: '', fullName: 'jane doe' },
        }}
      />,
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('applies green badge for Open status', () => {
    render(<CaseCard caseItem={baseCase} />);
    const badge = screen.getByText('Open');
    expect(badge.className).toContain('green');
  });

  it('applies gray badge for Closed status', () => {
    render(<CaseCard caseItem={{ ...baseCase, caseStatusDescription: 'Closed' }} />);
    const badge = screen.getByText('Closed');
    expect(badge.className).toContain('gray');
  });

  it('applies amber badge for unknown status', () => {
    render(<CaseCard caseItem={{ ...baseCase, caseStatusDescription: 'Pending Review' }} />);
    const badge = screen.getByText('Pending Review');
    expect(badge.className).toContain('amber');
  });
});
