import '../../jest-dom-vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PosterSet } from '../components/PosterSet';

const tmdb = { name: 'TMDB', attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.' };
const four = ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'].map((path) => ({ posterUrl: `https://image.tmdb.org/t/p/w342${path}`, posterSource: tmdb }));

// POSTERS-MULTI P5, direction ب: the strip is the only way to another poster,
// so it has to be fully visible, named, and reachable without a gesture.
describe('PosterSet', () => {
  it('renders nothing for a film with fewer than two posters', () => {
    const { container, rerender } = render(<PosterSet lang="ar" posters={[]} selected={0} onSelect={() => {}} />);
    expect(container.childElementCount).toBe(0);
    rerender(<PosterSet lang="ar" posters={four.slice(0, 1)} selected={0} onSelect={() => {}} />);
    expect(container.childElementCount).toBe(0);
  });

  it('names every poster, marks the chosen one and reports a tap', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PosterSet lang="ar" posters={four} selected={0} onSelect={onSelect} />);

    const group = screen.getByRole('group', { name: 'بوسترات الفيلم' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'البوستر 1 من 4',
      'البوستر 2 من 4',
      'البوستر 3 من 4',
      'البوستر 4 من 4',
    ]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons.map((button) => button.querySelector('img')?.getAttribute('src'))).toEqual(four.map((poster) => poster.posterUrl));

    await user.click(buttons[2]);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('walks the strip with the arrow keys in the screen direction', async () => {
    const user = userEvent.setup();
    render(<PosterSet lang="ar" posters={four} selected={0} onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');

    buttons[0].focus();
    // Arabic reads right to left: the next poster is to the left.
    await user.keyboard('{ArrowLeft}');
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(buttons[3]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(buttons[0]).toHaveFocus();
  });

  it('speaks English on the English screen, with the arrows mirrored', async () => {
    const user = userEvent.setup();
    render(<PosterSet lang="en" posters={four.slice(0, 2)} selected={1} onSelect={() => {}} />);
    expect(screen.getByRole('group', { name: 'Film posters' })).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons[1]).toHaveAttribute('aria-label', 'Poster 2 of 2');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');

    buttons[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(buttons[1]).toHaveFocus();
  });
});
