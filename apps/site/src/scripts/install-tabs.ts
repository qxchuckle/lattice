class InstallTabs extends HTMLElement {
  connectedCallback(): void {
    if (this.dataset.enhanced) return;
    this.dataset.enhanced = 'true';
    const tabs = [...this.querySelectorAll<HTMLButtonElement>('[data-install-method]')];
    const panels = [...this.querySelectorAll<HTMLElement>('[data-install-panel]')];
    const tablist = this.querySelector<HTMLElement>('[role="tablist"]');
    const feedback = this.querySelector<HTMLElement>('[role="status"]');
    if (!tabs.length || !panels.length || !tablist) return;
    const zh = this.dataset.locale === 'zh';
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const select = (method: string, focus = false) => {
      const selected = tabs.find((tab) => tab.dataset.installMethod === method);
      if (!selected) return;
      generation++;
      clearTimeout(timer);
      if (feedback) feedback.textContent = '';
      tabs.forEach((tab) => {
        tab.setAttribute('aria-selected', String(tab === selected));
        tab.tabIndex = tab === selected ? 0 : -1;
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.installPanel !== method;
      });
      this.dataset.activeMethod = method;
      if (focus) selected.focus();
    };
    tablist.hidden = false;
    panels.forEach((panel) => panel.setAttribute('role', 'tabpanel'));
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab.dataset.installMethod!));
      tab.addEventListener('keydown', (event) => {
        let next: number;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(tabs[next].dataset.installMethod!, true);
      });
    });
    this.querySelectorAll<HTMLButtonElement>('[data-install-switch]').forEach((button) => {
      button.hidden = false;
      button.addEventListener('click', () => select(button.dataset.installSwitch!, true));
    });
    this.querySelectorAll<HTMLButtonElement>('[data-install-copy]').forEach((button) => {
      button.hidden = false;
      button.addEventListener('click', async () => {
        const panel = button.closest<HTMLElement>('[data-install-panel]');
        const command = panel?.querySelector<HTMLElement>('[data-install-command]')?.textContent;
        if (!command || panel?.hidden) return;
        const request = ++generation;
        clearTimeout(timer);
        let copied: boolean;
        try {
          await navigator.clipboard.writeText(command);
          copied = true;
        } catch {
          const previous = document.activeElement;
          const textarea = document.createElement('textarea');
          textarea.value = command;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          textarea.setAttribute('aria-label', zh ? '安装命令' : 'Install command');
          document.body.appendChild(textarea);
          try {
            textarea.select();
            copied = document.execCommand('copy');
          } catch {
            copied = false;
          } finally {
            textarea.remove();
            if (previous instanceof HTMLElement) previous.focus();
          }
        }
        if (request !== generation || !feedback) return;
        feedback.textContent = copied
          ? zh
            ? '安装命令已复制'
            : 'Install command copied'
          : zh
            ? '复制失败，请手动选择命令'
            : 'Copy failed. Select the command manually.';
        timer = setTimeout(() => {
          if (feedback) feedback.textContent = '';
        }, 2500);
      });
    });
    select(this.dataset.defaultMethod || tabs[0].dataset.installMethod!);
  }
}
if (!customElements.get('lattice-install-tabs'))
  customElements.define('lattice-install-tabs', InstallTabs);
