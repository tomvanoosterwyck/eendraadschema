export interface MenuItem {
    name: string;
    callback: () => void;
}

export class TopMenu {
    private ulElement: HTMLUListElement;
    private liClassName: string;
    private menuItems: MenuItem[];

    constructor(ulId: string, liClassName: string, menuItems: MenuItem[]) {
        this.ulElement = document.getElementById(ulId) as HTMLUListElement;
        this.liClassName = liClassName;
        this.menuItems = menuItems;

        this.renderMenu();
        this.resetToFirstItem(); // Ensure the first item is selected initially
    }

    private renderMenu() {
        // Preserve any "right-side" widgets that were appended to the <ul>
        // (e.g. hamburger/auth dropdown). Those are not part of the menuItems array.
        const preserved = Array.from(this.ulElement.children).filter((el) =>
            (el as HTMLElement).classList?.contains('menu-item-right')
        ) as HTMLElement[];

        this.ulElement.innerHTML = ''; // Clear any existing content
        this.menuItems.forEach(item => {
            const liElement = document.createElement('li');
            const aElement = document.createElement('a');

            liElement.className = this.liClassName;
            aElement.innerText = item.name;

            aElement.addEventListener('click', () => {
                this.selectItem(aElement);
                item.callback();
            });

            liElement.appendChild(aElement);
            this.ulElement.appendChild(liElement);
        });

        // Re-attach preserved widgets.
        preserved.forEach((el) => this.ulElement.appendChild(el));
    }

    private selectItem(selectedElement: HTMLAnchorElement) {
        // Remove 'current' ID from all <a> elements
        const items = this.ulElement.querySelectorAll('a');
        items.forEach(item => item.removeAttribute('id'));

        // Add 'current' ID to the clicked <a> element
        selectedElement.id = 'current';
    }

    private findAnchorByName(name: string): HTMLAnchorElement | null {
        return (
            Array.from(this.ulElement.querySelectorAll('a')).find(
                a => (a as HTMLAnchorElement).innerText === name
            ) as HTMLAnchorElement | undefined
        ) || null;
    }

    public highlightMenuItemByName(name: string) {
        const aElement = this.findAnchorByName(name);
        if (aElement) {
            this.selectItem(aElement);
        }
    }

    public resetToFirstItem() {
        const firstItem = this.ulElement.querySelector('a');
        if (firstItem) {
            this.selectItem(firstItem as HTMLAnchorElement);
        }
    }

    public selectMenuItemByName(name: string) { 
        const item = this.menuItems.find(menuItem => menuItem.name === name); 
        if (item) { 
            const aElement = this.findAnchorByName(name);
            if (aElement) {
                this.selectItem(aElement);
                item.callback();
            }
        } 
    }

    public setMenuItems(menuItems: MenuItem[]) {
        const current = this.ulElement.querySelector('a#current') as HTMLAnchorElement | null;
        const currentName = current?.innerText;

        this.menuItems = menuItems;
        this.renderMenu();

        if (currentName && this.menuItems.some(mi => mi.name === currentName)) {
            this.highlightMenuItemByName(currentName);
        } else {
            this.resetToFirstItem();
        }
    }

    public selectMenuItemByOrdinal(nr: number) {
        // Remove 'current' ID from all <a> elements
        const items = this.ulElement.querySelectorAll('a');
        items.forEach(item => item.removeAttribute('id'));

        this.selectItem(items[nr]);
    }
    
}


