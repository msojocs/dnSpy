import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider, useLanguage } from './localization'

const LanguageProbe = (): React.JSX.Element => {
  const { locale, setLanguage, t } = useLanguage()
  return (
    <div>
      <span>{locale}</span>
      <span>{t('Opened {count} module(s).', { count: 2 })}</span>
      <button onClick={() => setLanguage('en')}>{t('English')}</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('localization', () => {
  it('renders Simplified Chinese and switches languages immediately', async () => {
    const setLocale = vi.fn(async () => undefined)
    Object.defineProperty(window, 'dnSpy', { configurable: true, value: { ...window.dnSpy, setLocale } })

    render(<LanguageProvider initialLanguage="zh-CN"><LanguageProbe /></LanguageProvider>)

    expect(screen.getByText('已打开 2 个模块。')).toBeVisible()
    expect(document.documentElement).toHaveAttribute('lang', 'zh-CN')
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByText('Opened 2 module(s).')).toBeVisible()
    await waitFor(() => expect(setLocale).toHaveBeenLastCalledWith('en'))
  })

  it('loads and persists the selected language', async () => {
    localStorage.setItem('dnspy.language', 'zh-CN')
    render(<LanguageProvider><LanguageProbe /></LanguageProvider>)

    expect(screen.getByText('zh-CN')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    await waitFor(() => expect(localStorage.getItem('dnspy.language')).toBe('en'))
  })
})

