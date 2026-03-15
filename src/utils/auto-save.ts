import { saveTemplateSettings, editingTemplateIndex } from '../managers/template-manager';
import { updateTemplateList, addPropertyToEditor, updateTemplateFromForm } from '../managers/template-ui';

let isReordering = false;

export function initializeAutoSave(): void {
	const templateForm = document.getElementById('template-settings-form');
	if (!templateForm) {
		console.error('Template form not found');
		return;
	}

	const debounce = <T extends (...args: any[]) => any>(func: T, delay: number): ((...args: Parameters<T>) => void) => {
		let debounceTimer: NodeJS.Timeout | null = null;
		return function(this: any, ...args: Parameters<T>) {
			const context = this;
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => func.apply(context, args), delay);
		}
	};

	const autoSave = debounce(async () => {
		if (!isReordering) {
			try {
				const warnings = await saveTemplateSettings();
				if (warnings.length > 0) {
					updateTemplateList();
					console.log('Auto-save completed');
					showWarnings(warnings);
				}
			} catch (error) {
				console.error('Auto-save failed:', error);
			}
		}
	}, 1000); // Increased debounce time to 1 second

	templateForm.addEventListener('input', () => {
		if (editingTemplateIndex !== -1) {
			updateTemplateFromForm();
			autoSave();
		}
	});

	// 监听图片下载设置相关的 change 事件（如 checkbox、number 输入等）
	templateForm.addEventListener('change', (event) => {
		const target = event.target as HTMLElement;
		// 检查是否是图片下载设置相关的字段
		const imageDownloadFields = [
			'image-download-toggle',
			'attachment-folder',
			'file-name-format',
			'max-images',
			'min-image-size',
			'api-base-url',
			'api-auth-token'
		];
		if (imageDownloadFields.includes(target.id)) {
			console.log('图片下载设置变化:', target.id, 'editingTemplateIndex:', editingTemplateIndex);
			if (editingTemplateIndex !== -1) {
				updateTemplateFromForm();
				console.log('已调用 updateTemplateFromForm，准备自动保存...');
				autoSave();
			}
		}
	});

	const templateProperties = document.getElementById('template-properties');
	if (templateProperties) {
		templateProperties.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.classList.contains('remove-property-btn') || target.closest('.remove-property-btn')) {
				if (editingTemplateIndex !== -1) {
					updateTemplateFromForm();
					autoSave();
				}
			}
		});

		templateProperties.addEventListener('change', (event) => {
			const target = event.target as HTMLElement;
			if (target.classList.contains('property-type')) {
				if (editingTemplateIndex !== -1) {
					updateTemplateFromForm();
					autoSave();
				}
			}
		});
	}
}

function showWarnings(warnings: string[]) {
	// Add a toast notification for this
	console.warn(warnings.join('\n'));
}
