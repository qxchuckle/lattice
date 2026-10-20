import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { LoginPage } from '../src/components/LoginPage';
import { setAdapter } from '../src/adapters';
import { installDomStubs, renderUi } from './helpers/component';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname}</div>;
}

function makeAdapter(login: ReturnType<typeof vi.fn>) {
  return { login };
}

beforeEach(() => {
  installDomStubs();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('成功登录：保存 token 并跳转首页', async () => {
    const login = vi.fn(async () => ({ token: 'tok-123' }));
    setAdapter(makeAdapter(login) as never);
    renderUi(
      <>
        <LoginPage />
        <LocationProbe />
      </>,
      { route: '/login' },
    );
    expect(screen.getByText('Lattice Web')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('secret', true));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(localStorage.getItem('lattice-web-auth-token')).toBe('tok-123');
  });

  it('密码错误与通用失败分支；可取消记住登录', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new Error('unauthorized'))
      .mockRejectedValueOnce(new Error('network down'));
    setAdapter(makeAdapter(login) as never);
    renderUi(<LoginPage />, { route: '/login' });

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    await waitFor(() => expect(screen.getByText('密码错误')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    await waitFor(() => expect(screen.getByText(/登录失败: network down/)).toBeTruthy());
    expect(login).toHaveBeenLastCalledWith('x', false);
  });
});
