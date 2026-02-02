export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'eds.theme';
const THEME_CHANGED_EVENT = 'eds-theme-changed';

function isTheme(value: unknown): value is Theme {
    return value === 'light' || value === 'dark';
}

function getSystemTheme(): Theme {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return isTheme(stored) ? stored : null;
    } catch {
        return null;
    }
}

function dispatchThemeChanged(theme: Theme) {
    try {
        window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: theme }));
    } catch {
        // no-op
    }
}

export function getActiveTheme(): Theme {
    const theme = document.documentElement.dataset.theme;
    return theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, options?: { persist?: boolean }) {
    const persist = options?.persist ?? true;

    document.documentElement.dataset.theme = theme;
    // Helps native controls (scrollbars/form controls) pick correct palette
    document.documentElement.style.colorScheme = theme;

    if (persist) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            // no-op
        }
    }

    dispatchThemeChanged(theme);
}

export function clearThemePreference() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // no-op
    }

    const systemTheme = getSystemTheme();
    applyTheme(systemTheme, { persist: false });
}

export function toggleTheme() {
    const current = getActiveTheme();
    const next: Theme = current === 'dark' ? 'light' : 'dark';
    applyTheme(next, { persist: true });
}

export function initTheme() {
    const stored = getStoredTheme();
    if (stored) {
        applyTheme(stored, { persist: false });
    } else {
        applyTheme(getSystemTheme(), { persist: false });
    }

    if (typeof window.matchMedia === 'function') {
        const media = window.matchMedia('(prefers-color-scheme: dark)');

        const onChange = () => {
            // Only follow system when user hasn’t chosen explicitly.
            if (getStoredTheme()) return;
            applyTheme(getSystemTheme(), { persist: false });
        };

        // Safari compatibility: addEventListener may not exist
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', onChange);
        } else if (typeof (media as any).addListener === 'function') {
            (media as any).addListener(onChange);
        }
    }
}

export function onThemeChanged(handler: (theme: Theme) => void) {
    window.addEventListener(THEME_CHANGED_EVENT, (ev: Event) => {
        const custom = ev as CustomEvent;
        const theme = custom.detail;
        if (isTheme(theme)) handler(theme);
    });
}
