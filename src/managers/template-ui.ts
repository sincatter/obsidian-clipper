import { Template, Property, ImageDownloadSettings } from '../types/types';
import { deleteTemplate, templates, editingTemplateIndex, saveTemplateSettings, setEditingTemplateIndex, loadTemplates } from './template-manager';
import { initializeIcons, getPropertyTypeIcon } from '../icons/icons';
import { updateToggleState, initializeToggles } from '../utils/ui-utils';
import { escapeValue, unescapeValue } from '../utils/string-utils';
import { generalSettings } from '../utils/storage-utils';
import { updateUrl } from '../utils/routing';
import { handleDragStart, handleDragOver, handleDrop, handleDragEnd } from '../utils/drag-and-drop';
import { createElementWithClass, createElementWithHTML } from '../utils/dom-utils';
import { updatePromptContextVisibility } from './interpreter-settings';
import { showSettingsSection } from './settings-section-ui';
import { updatePropertyType } from './property-types-manager';
import { getMessage } from '../utils/i18n';
import { parse, validateVariables, validateFilters } from '../utils/parser';
import { checkObsidianApiAvailable } from '../utils/image-downloader';
let hasUnsavedChanges = false;

export function resetUnsavedChanges(): void {
	hasUnsavedChanges = false;
}

export function updateTemplateList(loadedTemplates?: Template[]): void {
	const templateList = document.getElementById('template-list');
	if (!templateList) {
		console.error('Template list element not found');
		return;
	}
	
	const templatesToUse = loadedTemplates || templates;
	
	// Filter out null or undefined templates
	const validTemplates = templatesToUse.filter((template): template is Template => 
		template != null && typeof template === 'object' && 'id' in template && 'name' in template
	);

	// Clear existing templates
	templateList.textContent = '';
	validTemplates.forEach((template, index) => {
		const li = document.createElement('li');
		
		const dragHandle = createElementWithClass('div', 'drag-handle');
		dragHandle.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'grip-vertical' }));
		li.appendChild(dragHandle);

		const templateName = createElementWithClass('span', 'template-name');
		templateName.textContent = template.name;
		li.appendChild(templateName);

		const deleteBtn = createElementWithClass('button', 'delete-template-btn clickable-icon');
		deleteBtn.setAttribute('type', 'button');
		deleteBtn.setAttribute('aria-label', 'Delete template');
		deleteBtn.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'trash-2' }));
		li.appendChild(deleteBtn);

		li.dataset.id = template.id;
		li.dataset.index = index.toString();
		li.draggable = true;

		let touchStartTime: number;
		let touchStartY: number;

		li.addEventListener('touchstart', (e) => {
			touchStartTime = Date.now();
			touchStartY = e.touches[0].clientY;
		});

		li.addEventListener('touchend', (e) => {
			const touchEndY = e.changedTouches[0].clientY;
			const touchDuration = Date.now() - touchStartTime;
			const touchDistance = Math.abs(touchEndY - touchStartY);

			if (touchDuration < 300 && touchDistance < 10) {
				const target = e.target as HTMLElement;
				if (!target.closest('.delete-template-btn')) {
					e.preventDefault();
					showTemplateEditor(template);
					// Add these lines to close the sidebar and deactivate the hamburger menu
					const settingsContainer = document.getElementById('settings');
					const hamburgerMenu = document.getElementById('hamburger-menu');
					if (settingsContainer) {
						settingsContainer.classList.remove('sidebar-open');
					}
					if (hamburgerMenu) {
						hamburgerMenu.classList.remove('is-active');
					}
				}
			}
		});

		// Keep the click event for non-touch devices
		li.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			if (!target.closest('.delete-template-btn')) {
				showTemplateEditor(template);
			}
		});

		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			deleteTemplateFromList(template.id);
		});
		
		if (index === editingTemplateIndex) {
			li.classList.add('active');
		}
		templateList.appendChild(li);
	});

	// If any invalid templates were found and removed, save the changes
	if (validTemplates.length !== templatesToUse.length) {
		saveTemplateSettings();
	}

	initializeIcons(templateList);
}

// Rename this function to make it clear it's for deleting from the list
async function deleteTemplateFromList(templateId: string): Promise<void> {
	const template = templates.find(t => t.id === templateId);
	if (!template) {
		console.error('Template not found:', templateId);
		return;
	}

	if (confirm(getMessage('confirmDeleteTemplate', [template.name]))) {
		const success = await deleteTemplate(templateId);
		if (success) {
			const updatedTemplates = await loadTemplates();
			updateTemplateList(updatedTemplates);
			if (updatedTemplates.length > 0) {
				showTemplateEditor(updatedTemplates[0]);
			} else {
				showSettingsSection('general');
			}
		} else {
			alert(getMessage('failedToDeleteTemplate'));
		}
	}
}

export function showTemplateEditor(template: Template | null): void {
	let editingTemplate: Template;

	if (!template) {
		const newTemplateName = getUniqueTemplateName(getMessage('newTemplate'));
		editingTemplate = {
			id: Date.now().toString() + Math.random().toString(36).slice(2, 11),
			name: newTemplateName,
			behavior: 'create',
			noteNameFormat: '{{title}}',
			path: 'Clippings',
			noteContentFormat: '{{content}}',
			properties: [],
			triggers: [],
			context: ''
		};
		templates.unshift(editingTemplate);
		setEditingTemplateIndex(0);
		saveTemplateSettings().then(() => {
			updateTemplateList();
		}).catch(error => {
			console.error('Failed to save new template:', error);
		});
	} else {
		editingTemplate = template;
		setEditingTemplateIndex(templates.findIndex(t => t.id === editingTemplate.id));
	}

	// Ensure properties is always an array
	if (!editingTemplate.properties) {
		editingTemplate.properties = [];
	}

	const templateEditorTitle = document.getElementById('template-editor-title');
	const templateName = document.getElementById('template-name') as HTMLInputElement;
	const templateProperties = document.getElementById('template-properties');

	if (templateEditorTitle) templateEditorTitle.textContent = getMessage('editTemplate');
	if (templateName) templateName.value = editingTemplate.name;
	if (templateProperties) templateProperties.textContent = '';

	const pathInput = document.getElementById('template-path-name') as HTMLInputElement;
	if (pathInput) {
		pathInput.value = editingTemplate.path || '';
		validateTemplateField(pathInput, false);
	}

	const behaviorSelect = document.getElementById('template-behavior') as HTMLSelectElement;
	if (behaviorSelect) behaviorSelect.value = editingTemplate.behavior || 'create';

	const noteNameFormat = document.getElementById('note-name-format') as HTMLInputElement;
	if (noteNameFormat) {
		noteNameFormat.value = editingTemplate.noteNameFormat || '{{title}}';
		validateTemplateField(noteNameFormat, false);
	}

	const noteContentFormat = document.getElementById('note-content-format') as HTMLTextAreaElement;
	if (noteContentFormat) {
		noteContentFormat.value = editingTemplate.noteContentFormat || '';
		validateTemplateField(noteContentFormat, true);
	}

	const promptContextTextarea = document.getElementById('prompt-context') as HTMLTextAreaElement;
	if (promptContextTextarea) {
		promptContextTextarea.value = editingTemplate.context || '';
		validateTemplateField(promptContextTextarea, true);
	}

	updateBehaviorFields();

	if (behaviorSelect) {
		behaviorSelect.addEventListener('change', updateBehaviorFields);
	}

	refreshPropertyNameSuggestions();

	if (editingTemplate && Array.isArray(editingTemplate.properties)) {
		editingTemplate.properties.forEach(property => addPropertyToEditor(property.name, property.value, property.id));
	}

	const triggersTextarea = document.getElementById('url-patterns') as HTMLTextAreaElement;
	if (triggersTextarea) triggersTextarea.value = editingTemplate && editingTemplate.triggers ? editingTemplate.triggers.join('\n') : '';

	// Initialize image download settings
	initializeImageDownloadSettings(editingTemplate);

	// Initialize toggles for the template editor area
	initializeToggles('template-settings-form');

	showSettingsSection('templates', editingTemplate.id);

	if (!editingTemplate.id) {
		const templateNameField = document.getElementById('template-name') as HTMLInputElement;
		if (templateNameField) {
			templateNameField.focus();
			templateNameField.select();
		}
	}

	resetUnsavedChanges();

	if (templateName) {
		templateName.addEventListener('input', () => {
			if (editingTemplateIndex !== -1 && templates[editingTemplateIndex]) {
				templates[editingTemplateIndex].name = templateName.value;
				updateTemplateList();
			}
		});
	}

	const vaultSelect = document.getElementById('template-vault') as HTMLSelectElement;
	if (vaultSelect) {
		// Clear existing vault options
		vaultSelect.textContent = '';
		const lastUsedOption = document.createElement('option');
		lastUsedOption.value = '';
		lastUsedOption.textContent = getMessage('lastUsed');
		vaultSelect.appendChild(lastUsedOption);
		generalSettings.vaults.forEach(vault => {
			const option = document.createElement('option');
			option.value = vault;
			option.textContent = vault;
			vaultSelect.appendChild(option);
		});
		vaultSelect.value = editingTemplate.vault || '';
	}

	updateUrl('templates', editingTemplate.id);
	updatePromptContextVisibility();
}

function updateBehaviorFields(): void {
	const behaviorSelect = document.getElementById('template-behavior') as HTMLSelectElement;
	const noteNameFormatContainer = document.getElementById('note-name-format-container');
	const pathContainer = document.getElementById('path-name-container');
	const noteNameFormat = document.getElementById('note-name-format') as HTMLInputElement;

	if (behaviorSelect) {
		const selectedBehavior = behaviorSelect.value;
		const isDailyNote = selectedBehavior === 'append-daily' || selectedBehavior === 'prepend-daily';

		if (noteNameFormatContainer) noteNameFormatContainer.style.display = isDailyNote ? 'none' : 'block';
		if (pathContainer) pathContainer.style.display = isDailyNote ? 'none' : 'block';

		if (noteNameFormat) {
			noteNameFormat.required = !isDailyNote;
			switch (selectedBehavior) {
				case 'append-specific':
				case 'prepend-specific':
				case 'overwrite':
					noteNameFormat.placeholder = getMessage('specificNoteName');
					break;
				case 'append-daily':
				case 'prepend-daily':
					noteNameFormat.placeholder = getMessage('dailyNoteFormat');
					break;
				default:
					noteNameFormat.placeholder = getMessage('noteNameFormat');
			}
		}
	}
}

export function addPropertyToEditor(name: string = '', value: string = '', id: string | null = null): HTMLElement {
	const templateProperties = document.getElementById('template-properties');
	if (!templateProperties) {
		console.error('Template properties container not found');
		// Return a dummy element to satisfy the return type
		return document.createElement('div');
	}

	const propertyId = id || Date.now().toString() + Math.random().toString(36).slice(2, 11);
	const propertyDiv = createElementWithClass('div', 'property-editor');
	propertyDiv.dataset.id = propertyId;

	const propertyRow = createElementWithClass('div', 'property-row');

	const dragHandle = createElementWithClass('div', 'drag-handle');
	dragHandle.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'grip-vertical' }));
	propertyRow.appendChild(dragHandle);

	const propertySelectDiv = createElementWithClass('div', 'property-select');
	const propertySelectedDiv = createElementWithClass('div', 'property-selected');
	const propertyType = generalSettings.propertyTypes.find(p => p.name === name)?.type || 'text';
	propertySelectedDiv.dataset.value = propertyType;
	propertySelectedDiv.appendChild(createElementWithHTML('i', '', { 'data-lucide': getPropertyTypeIcon(propertyType) }));
	propertySelectDiv.appendChild(propertySelectedDiv);

	const select = document.createElement('select');
	select.className = 'property-type';
	select.id = `${propertyId}-type`;
	['text', 'multitext', 'number', 'checkbox', 'date', 'datetime'].forEach(optionValue => {
		const option = document.createElement('option');
		option.value = optionValue;
		const messageKey = `propertyType${optionValue.charAt(0).toUpperCase() + optionValue.slice(1)}`;
		option.textContent = getMessage(messageKey);
		select.appendChild(option);
	});
	select.value = propertyType;
	propertySelectDiv.appendChild(select);
	propertyRow.appendChild(propertySelectDiv);

	const nameInput = createElementWithHTML('input', '', {
		type: 'text',
		class: 'property-name',
		id: `${propertyId}-name`,
		value: name,
		placeholder: getMessage('propertyName'),
		autocapitalize: 'off',
		autocomplete: 'off',
		list: 'property-name-suggestions'
	});
	propertyRow.appendChild(nameInput);

	// Create datalist for autocomplete if it doesn't exist
	let datalist = document.getElementById('property-name-suggestions');
	if (!datalist) {
		datalist = document.createElement('datalist');
		datalist.id = 'property-name-suggestions';
		document.body.appendChild(datalist);
	}

	// Populate datalist with existing property types
	updatePropertyNameSuggestions();

	const valueInput = createElementWithHTML('input', '', {
		type: 'text',
		class: 'property-value',
		id: `${propertyId}-value`,
		value: unescapeValue(value),
		placeholder: getMessage('propertyValue')
	}) as HTMLInputElement;
	propertyRow.appendChild(valueInput);

	const removeBtn = createElementWithClass('button', 'remove-property-btn clickable-icon');
	removeBtn.setAttribute('type', 'button');
	removeBtn.setAttribute('aria-label', getMessage('removeProperty'));
	removeBtn.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'trash-2' }));
	propertyRow.appendChild(removeBtn);
	propertyDiv.appendChild(propertyRow);

	// Add validation for property value (will appear after the row, inside propertyDiv)
	valueInput.addEventListener('blur', () => validateTemplateField(valueInput, false, propertyDiv));
	// Validate on load if there's a value
	if (value) {
		validateTemplateField(valueInput, false, propertyDiv);
	}

	templateProperties.appendChild(propertyDiv);

	propertyDiv.addEventListener('mousedown', (event) => {
		const target = event.target as HTMLElement;
		if (!target.closest('input, select, button')) {
			propertyDiv.setAttribute('draggable', 'true');
			templateProperties.querySelectorAll('.property-editor').forEach((el) => {
				if (el !== propertyDiv) {
					el.setAttribute('draggable', 'true');
				}
			});
		}
	});

	const resetDraggable = () => {
		propertyDiv.removeAttribute('draggable');
		templateProperties.querySelectorAll('.property-editor').forEach((el) => {
			el.removeAttribute('draggable');
		});
	};

	propertyDiv.addEventListener('dragend', resetDraggable);
	propertyDiv.addEventListener('mouseup', resetDraggable);

	if (select) {
		select.addEventListener('change', function() {
			if (propertySelectedDiv) updateSelectedOption(this.value, propertySelectedDiv);
			
			// Get the current name of the property
			const nameInput = propertyDiv.querySelector('.property-name') as HTMLInputElement;
			const currentName = nameInput.value;

			// Update the global property type
			updatePropertyType(currentName, this.value).then(() => {
				console.log(`Property type for ${currentName} updated to ${this.value}`);
			}).catch(error => {
				console.error(`Failed to update property type for ${currentName}:`, error);
			});

			updateTemplateFromForm();
		});
	}

	if (removeBtn) {
		removeBtn.addEventListener('click', () => {
			templateProperties.removeChild(propertyDiv);
		});
	}

	propertyDiv.addEventListener('dragstart', handleDragStart);
	propertyDiv.addEventListener('dragover', handleDragOver);
	propertyDiv.addEventListener('drop', handleDrop);
	propertyDiv.addEventListener('dragend', handleDragEnd);

	updateSelectedOption(propertyType, propertySelectedDiv);

	initializeIcons(propertyDiv);

	nameInput.addEventListener('input', function(this: HTMLInputElement) {
		const selectedType = generalSettings.propertyTypes.find(pt => pt.name === this.value);
		if (selectedType) {
			select.value = selectedType.type;
			updateSelectedOption(selectedType.type, propertySelectedDiv);
			
			// Only update the property type if the name is not empty
			if (this.value.trim() !== '') {
				updatePropertyType(this.value, selectedType.type).then(() => {
					console.log(`Property type for ${this.value} updated to ${selectedType.type}`);
				}).catch(error => {
					console.error(`Failed to update property type for ${this.value}:`, error);
				});
			}
			
			// Fill in the default value if it exists and the value input is empty
			if (selectedType.defaultValue && !valueInput.value) {
				valueInput.value = selectedType.defaultValue;
			}

			// Immediately update the template form
			updateTemplateFromForm();
		}
	});

	// Add a change event listener to handle selection from autocomplete
	nameInput.addEventListener('change', function(this: HTMLInputElement) {
		const selectedType = generalSettings.propertyTypes.find(pt => pt.name === this.value);
		if (selectedType) {
			// Fill in the default value if it exists, regardless of current value
			if (selectedType.defaultValue) {
				valueInput.value = selectedType.defaultValue;
			}
		}
	});

	return propertyDiv; // Return the created propertyDiv
}

function updateSelectedOption(value: string, propertySelected: HTMLElement): void {
	const iconName = getPropertyTypeIcon(value);
	
	// Clear existing content
	propertySelected.textContent = '';
	
	// Create and append the new icon element
	const iconElement = createElementWithHTML('i', '', { 'data-lucide': iconName });
	propertySelected.appendChild(iconElement);
	
	propertySelected.setAttribute('data-value', value);
	initializeIcons(propertySelected);
}

export function updateTemplateFromForm(): void {
	if (editingTemplateIndex === -1) return;

	const template = templates[editingTemplateIndex];
	if (!template) {
		console.error('Template not found');
		return;
	}

	const behaviorSelect = document.getElementById('template-behavior') as HTMLSelectElement;
	if (behaviorSelect) template.behavior = behaviorSelect.value as Template['behavior'];

	const isDailyNote = template.behavior === 'append-daily' || template.behavior === 'prepend-daily';

	const pathInput = document.getElementById('template-path-name') as HTMLInputElement;
	if (pathInput) template.path = pathInput.value;

	const noteNameFormat = document.getElementById('note-name-format') as HTMLInputElement;
	if (noteNameFormat) {
		if (!isDailyNote && noteNameFormat.value.trim() === '') {
			console.error('Note name format is required for non-daily note behaviors');
			noteNameFormat.setCustomValidity(getMessage('noteNameRequired'));
			noteNameFormat.reportValidity();
			return;
		} else {
			noteNameFormat.setCustomValidity('');
			template.noteNameFormat = noteNameFormat.value;
		}
	}

	const noteContentFormat = document.getElementById('note-content-format') as HTMLTextAreaElement;
	if (noteContentFormat) template.noteContentFormat = noteContentFormat.value;

	const promptContextTextarea = document.getElementById('prompt-context') as HTMLTextAreaElement;
	if (promptContextTextarea) template.context = promptContextTextarea.value;

	const propertyElements = document.querySelectorAll('#template-properties .property-editor');
	template.properties = Array.from(propertyElements).map(prop => {
		const nameInput = prop.querySelector('.property-name') as HTMLInputElement;
		const valueInput = prop.querySelector('.property-value') as HTMLInputElement;
		const typeSelect = prop.querySelector('.property-select .property-selected') as HTMLElement;
		return {
			id: (prop as HTMLElement).dataset.id || Date.now().toString() + Math.random().toString(36).slice(2, 11),
			name: nameInput.value,
			value: escapeValue(valueInput.value),
			type: typeSelect.getAttribute('data-value') || 'text'
		};
	}).filter(prop => prop.name.trim() !== ''); // Filter out properties with empty names

	const triggersTextarea = document.getElementById('url-patterns') as HTMLTextAreaElement;
	if (triggersTextarea) template.triggers = triggersTextarea.value.split('\n').filter(Boolean);

	const vaultSelect = document.getElementById('template-vault') as HTMLSelectElement;
	if (vaultSelect) template.vault = vaultSelect.value || undefined;

	// Save image download settings
	saveImageDownloadSettings(template);

	hasUnsavedChanges = true;
}

function clearTemplateEditor(): void {
	setEditingTemplateIndex(-1);
	const templateEditorTitle = document.getElementById('template-editor-title');
	const templateName = document.getElementById('template-name') as HTMLInputElement;
	const templateProperties = document.getElementById('template-properties');
	if (templateEditorTitle) templateEditorTitle.textContent = getMessage('newTemplate');
	if (templateName) templateName.value = '';
	if (templateProperties) templateProperties.textContent = '';
	const pathInput = document.getElementById('template-path-name') as HTMLInputElement;
	if (pathInput) pathInput.value = 'Clippings';
	const triggersTextarea = document.getElementById('url-patterns') as HTMLTextAreaElement;
	if (triggersTextarea) triggersTextarea.value = '';
	const templateEditor = document.getElementById('template-editor');
	if (templateEditor) templateEditor.style.display = 'none';
}

export function initializeAddPropertyButton(): void {
	const addPropertyBtn = document.getElementById('add-property-btn');
	if (addPropertyBtn) {
		addPropertyBtn.removeEventListener('click', handleAddProperty);
		addPropertyBtn.addEventListener('click', handleAddProperty);
	} else {
		console.error('Add property button not found');
	}
}

function handleAddProperty(): void {
	const templateProperties = document.getElementById('template-properties');
	if (templateProperties) {
		const newPropertyDiv = addPropertyToEditor();
		if (newPropertyDiv.parentElement !== templateProperties) {
			templateProperties.appendChild(newPropertyDiv);
		}
		const nameInput = newPropertyDiv.querySelector('.property-name') as HTMLInputElement;
		if (nameInput) {
			nameInput.focus();
			nameInput.addEventListener('blur', () => {
				if (nameInput.value.trim() === '') {
					templateProperties.removeChild(newPropertyDiv);
				} else {
					updateTemplateFromForm();
				}
			}, { once: true });
		}
	}
}

function getUniqueTemplateName(baseName: string): string {
	const existingNames = new Set(templates.map(t => t.name));
	let newName = baseName;
	let counter = 1;

	while (existingNames.has(newName)) {
		newName = `${baseName} ${counter}`;
		counter++;
	}

	return newName;
}

function updatePropertyNameSuggestions(): void {
	const datalist = document.getElementById('property-name-suggestions');
	if (datalist) {
		// Clear existing suggestions
		datalist.textContent = '';
		generalSettings.propertyTypes.forEach(pt => {
			const option = document.createElement('option');
			option.value = pt.name;
			datalist.appendChild(option);
		});
	}
}

export function refreshPropertyNameSuggestions(): void {
	updatePropertyNameSuggestions();
}

/**
 * Update the error summary at the top of the template editor.
 */
function updateErrorSummary(): void {
	const templateEditor = document.getElementById('template-editor');
	if (!templateEditor) return;

	// Find or create the summary element
	let summaryEl = document.getElementById('template-error-summary');
	if (!summaryEl) {
		summaryEl = createElementWithClass('div', 'template-error-summary');
		summaryEl.id = 'template-error-summary';
		templateEditor.insertBefore(summaryEl, templateEditor.firstChild);
	}

	// Count errors from all validation elements
	const validationEls = document.querySelectorAll('.template-validation.invalid');
	let totalErrors = 0;
	validationEls.forEach(el => {
		const errorItems = el.querySelectorAll('.validation-error');
		totalErrors += errorItems.length;
	});

	// Clear and update summary
	summaryEl.textContent = '';
	summaryEl.className = 'template-error-summary';

	if (totalErrors === 0) {
		summaryEl.style.display = 'none';
		return;
	}

	summaryEl.classList.add('has-errors');
	const icon = createElementWithHTML('i', '', { 'data-lucide': 'alert-triangle' });
	summaryEl.appendChild(icon);

	const text = document.createElement('span');
	const messageKey = totalErrors === 1 ? 'templateErrorCount' : 'templateErrorsCount';
	text.textContent = getMessage(messageKey, totalErrors.toString());
	summaryEl.appendChild(text);

	summaryEl.style.display = 'flex';
	initializeIcons(summaryEl);
}

/**
 * Validate a template field and display results.
 * @param field The input or textarea element to validate
 * @param showLineNumbers Whether to show line numbers in error messages (for multiline fields)
 * @param appendTo Optional element to append the validation to (defaults to inserting after the field)
 */
function validateTemplateField(field: HTMLInputElement | HTMLTextAreaElement, showLineNumbers: boolean = false, appendTo?: HTMLElement): void {
	const content = field.value;
	const validationId = `${field.id}-validation`;

	// Find or create the validation result element
	let validationEl = document.getElementById(validationId);
	if (!validationEl) {
		validationEl = createElementWithClass('div', 'template-validation');
		validationEl.id = validationId;
		if (appendTo) {
			appendTo.appendChild(validationEl);
		} else {
			field.parentNode?.insertBefore(validationEl, field.nextSibling);
		}
	}

	// Clear previous content
	validationEl.textContent = '';
	validationEl.className = 'template-validation';

	// Skip validation for empty content
	if (!content.trim()) {
		validationEl.style.display = 'none';
		updateErrorSummary();
		return;
	}

	// Parse and check for errors
	const result = parse(content);

	// Validate variable names and filter usage
	const variableWarnings = validateVariables(result.ast);
	const filterWarnings = validateFilters(result.ast);

	// Combine errors and warnings into a single list
	const issues: { line: number; message: string; isError: boolean }[] = [
		...result.errors.map(e => ({ line: e.line || 0, message: e.message, isError: true })),
		...variableWarnings.map(w => ({ line: w.line || 0, message: w.message, isError: false })),
		...filterWarnings.map(w => ({ line: w.line || 0, message: w.message, isError: false })),
	].sort((a, b) => a.line - b.line);

	const hasErrors = result.errors.length > 0;
	const hasWarnings = variableWarnings.length > 0 || filterWarnings.length > 0;

	if (!hasErrors && !hasWarnings) {
		// Valid template - show nothing
		validationEl.style.display = 'none';
		updateErrorSummary();
		return;
	} else {
		// Has errors and/or warnings - use error styling if any errors, warning styling if only warnings
		validationEl.classList.add(hasErrors ? 'invalid' : 'warning');
		const icon = createElementWithHTML('i', '', { 'data-lucide': 'alert-triangle' });
		validationEl.appendChild(icon);

		const issueList = document.createElement('div');
		issueList.className = 'validation-errors';

		issues.forEach(issue => {
			const issueItem = document.createElement('div');
			issueItem.className = issue.isError ? 'validation-error' : 'validation-warning';
			const location = showLineNumbers && issue.line ? `Line ${issue.line}: ` : '';
			issueItem.textContent = `${location}${issue.message}`;
			issueList.appendChild(issueItem);
		});

		validationEl.appendChild(issueList);
		initializeIcons(validationEl);
	}

	validationEl.style.display = 'flex';
	updateErrorSummary();
}

/**
 * Add validation listener to a template field.
 */
function addValidationListener(field: HTMLInputElement | HTMLTextAreaElement | null, showLineNumbers: boolean = false): void {
	if (field) {
		field.addEventListener('blur', () => validateTemplateField(field, showLineNumbers));
	}
}

/**
 * Initialize template validation on all template fields.
 */
export function initializeTemplateValidation(): void {
	// Note content (multiline, show line numbers)
	const noteContentFormat = document.getElementById('note-content-format') as HTMLTextAreaElement;
	addValidationListener(noteContentFormat, true);

	// Note name format (single line)
	const noteNameFormat = document.getElementById('note-name-format') as HTMLInputElement;
	addValidationListener(noteNameFormat, false);

	// Path/folder (single line)
	const pathInput = document.getElementById('template-path-name') as HTMLInputElement;
	addValidationListener(pathInput, false);

	// Prompt context (multiline, show line numbers)
	const promptContext = document.getElementById('prompt-context') as HTMLTextAreaElement;
	addValidationListener(promptContext, true);
}

/**
 * 初始化图片下载设置 UI
 */
function initializeImageDownloadSettings(template: Template): void {
	const imageDownloadToggle = document.getElementById('image-download-toggle') as HTMLInputElement;
	const attachmentFolder = document.getElementById('attachment-folder') as HTMLInputElement;
	const fileNameFormat = document.getElementById('file-name-format') as HTMLInputElement;
	const maxImages = document.getElementById('max-images') as HTMLInputElement;
	const minImageSize = document.getElementById('min-image-size') as HTMLInputElement;

	// API 设置
	const apiBaseUrl = document.getElementById('api-base-url') as HTMLInputElement;
	const apiAuthToken = document.getElementById('api-auth-token') as HTMLInputElement;

	console.log('初始化图片下载设置，template.imageDownload:', template.imageDownload);

	const settings = template.imageDownload || {
		enabled: false,
		attachmentFolder: 'attachments',
		fileNameFormat: '{note}-{index}',
		maxImages: 50,
		minWidth: 10,
		minHeight: 10,
		apiBaseUrl: 'https://localhost:27124',
		apiAuthToken: ''
	};

	console.log('使用设置:', settings);
	console.log('checkbox 将设置为:', settings.enabled || false);

	if (imageDownloadToggle) {
		imageDownloadToggle.checked = settings.enabled || false;
		// 同步更新 checkbox-container 的 UI 状态
		const container = imageDownloadToggle.closest('.checkbox-container');
		if (container) {
			updateToggleState(container as HTMLElement, imageDownloadToggle);
		}
	}
	if (attachmentFolder) attachmentFolder.value = settings.attachmentFolder || 'attachments';
	if (fileNameFormat) fileNameFormat.value = settings.fileNameFormat || '{note}-{index}';
	if (maxImages) maxImages.value = String(settings.maxImages || 50);
	if (minImageSize) minImageSize.value = String(settings.minWidth || 10);

	// API 设置
	if (apiBaseUrl) apiBaseUrl.value = settings.apiBaseUrl || 'https://localhost:27124';
	if (apiAuthToken) apiAuthToken.value = settings.apiAuthToken || '';

	// 添加复选框监听器
	if (imageDownloadToggle) {
		imageDownloadToggle.onchange = () => {
			const newChecked = imageDownloadToggle.checked;
			console.log('checkbox change 事件，新状态:', newChecked);
			updateImageDownloadSettingsVisibility(newChecked);
		};
		// 初始化时调用一次以设置正确的可见性
		updateImageDownloadSettingsVisibility(imageDownloadToggle.checked);
	}

	// URL 输入时自动验证格式
	if (apiBaseUrl) {
		apiBaseUrl.onblur = () => {
			validateApiUrl(apiBaseUrl.value, apiBaseUrl);
		};
	}

	// 测试 API 按钮
	const apiTestBtn = document.getElementById('api-test-btn');
	if (apiTestBtn) {
		(apiTestBtn as HTMLButtonElement).onclick = () => {
			void testApiConnection();
		};
		// 翻译后存储初始按钮文本
		setTimeout(() => {
			apiTestBtn.setAttribute('data-original-text', apiTestBtn.textContent || 'Test');
		}, 100);
	}
}

/**
 * 验证 API URL 格式
 */
function validateApiUrl(url: string, input?: HTMLInputElement): boolean {
	if (!url || url.trim() === '') {
		if (input) {
			input.classList.add('mod-warning');
			showUrlValidationError(input, 'URL 不能为空');
		}
		return false;
	}

	// URL 格式验证正则
	const urlPattern = /^https?:\/\/(localhost|[\d\w\.-]+)(:[\d]+)?(\/.*)?$/i;

	if (!urlPattern.test(url)) {
		if (input) {
			input.classList.add('mod-warning');
			showUrlValidationError(input, 'URL 格式不正确，应为 http(s)://hostname:port 格式');
		}
		return false;
	}

	if (input) {
		input.classList.remove('mod-warning');
		hideUrlValidationError(input);
	}
	return true;
}

/**
 * 显示 URL 验证错误
 */
function showUrlValidationError(input: HTMLInputElement, message: string): void {
	const validationEl = document.getElementById(`${input.id}-validation`);
	if (validationEl) {
		validationEl.textContent = message;
		validationEl.style.display = 'block';
	}
}

/**
 * 隐藏 URL 验证错误
 */
function hideUrlValidationError(input: HTMLInputElement): void {
	const validationEl = document.getElementById(`${input.id}-validation`);
	if (validationEl) {
		validationEl.textContent = '';
		validationEl.style.display = 'none';
	}
}

/**
 * 测试 API 连接
 */
async function testApiConnection(): Promise<void> {
	const apiBaseUrl = document.getElementById('api-base-url') as HTMLInputElement;
	const apiAuthToken = document.getElementById('api-auth-token') as HTMLInputElement;
	const apiTestBtn = document.getElementById('api-test-btn') as HTMLButtonElement;

	if (!apiTestBtn) return;

	// 验证认证令牌是否必填
	if (!apiAuthToken?.value || apiAuthToken.value.trim() === '') {
		alert(getMessage('apiAuthTokenRequired') || '认证令牌是必填项');
		apiAuthToken?.focus();
		return;
	}

	// 验证 URL 格式
	if (!validateApiUrl(apiBaseUrl?.value?.trim() || '', apiBaseUrl || undefined)) {
		return;
	}

	// 存储原始文本
	const originalText = apiTestBtn.getAttribute('data-original-text') || 'Test';
	apiTestBtn.setAttribute('data-original-text', originalText);

	// 设置测试状态
	apiTestBtn.textContent = getMessage('testing') || 'Testing...';
	apiTestBtn.disabled = true;
	apiTestBtn.classList.remove('mod-success', 'mod-warning');

	const baseUrl = apiBaseUrl?.value?.trim() || '';
	const authToken = apiAuthToken?.value || '';

	try {
		const available = await checkObsidianApiAvailable({
			baseUrl,
			authToken
		});

		if (available) {
			apiTestBtn.textContent = getMessage('success') || 'Success!';
			apiTestBtn.classList.add('mod-success');
			// 测试成功，弹出提示框
			setTimeout(() => {
				alert(getMessage('apiConnectionSuccess') || 'API 连接测试成功！');
				apiTestBtn.textContent = originalText;
				apiTestBtn.disabled = false;
				apiTestBtn.classList.remove('mod-success');
			}, 100);
		} else {
			throw new Error('Authentication failed');
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		let displayMessage = getMessage('failed') || 'Failed';

		// 检查证书错误
		if (errorMessage.includes('ERR_CERT') || errorMessage.includes('certificate')) {
			displayMessage = getMessage('certificateError') || '证书错误 - 请确保插件使用有效的 TLS 证书';
		} else if (errorMessage.includes('timeout') || errorMessage.includes('AbortError')) {
			displayMessage = getMessage('connectionTimeout') || '连接超时';
		} else if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
			displayMessage = getMessage('networkError') || '网络错误 - 请检查 Obsidian 是否正在运行';
		}

		apiTestBtn.textContent = displayMessage;
		apiTestBtn.classList.add('mod-warning');
		// 失败后允许再次点击重试
		apiTestBtn.disabled = false;

		console.error('API 连接测试失败:', error);
	}
}

/**
 * 根据复选框更新图片下载设置的可见性
 */
function updateImageDownloadSettingsVisibility(enabled: boolean): void {
	const containers = [
		'attachment-folder-container',
		'file-name-format-container',
		'max-images-container',
		'min-image-size-container'
	];

	containers.forEach(id => {
		const el = document.getElementById(id);
		if (el) {
			const settingItem = el.closest('.setting-item') || el;
			settingItem.setAttribute('style', enabled ? '' : 'display: none;');
		}
	});

	// 同时控制 API 设置容器的可见性
	const apiSettingsContainer = document.getElementById('api-settings-container');
	if (apiSettingsContainer) {
		apiSettingsContainer.setAttribute('style', enabled ? '' : 'display: none;');
	}
}

/**
 * 从 UI 保存图片下载设置
 */
function saveImageDownloadSettings(template: Template): void {
	const imageDownloadToggle = document.getElementById('image-download-toggle') as HTMLInputElement;
	const attachmentFolder = document.getElementById('attachment-folder') as HTMLInputElement;
	const fileNameFormat = document.getElementById('file-name-format') as HTMLInputElement;
	const maxImages = document.getElementById('max-images') as HTMLInputElement;
	const minImageSize = document.getElementById('min-image-size') as HTMLInputElement;

	// API 设置
	const apiBaseUrl = document.getElementById('api-base-url') as HTMLInputElement;
	const apiAuthToken = document.getElementById('api-auth-token') as HTMLInputElement;

	const newSettings = {
		enabled: imageDownloadToggle?.checked || false,
		attachmentFolder: attachmentFolder?.value || 'attachments',
		fileNameFormat: fileNameFormat?.value || '{note}-{index}',
		maxImages: parseInt(maxImages?.value || '50', 10),
		minWidth: parseInt(minImageSize?.value || '10', 10),
		minHeight: parseInt(minImageSize?.value || '10', 10),
		apiBaseUrl: apiBaseUrl?.value || 'https://localhost:27124',
		apiAuthToken: apiAuthToken?.value || ''
	};

	console.log('保存图片下载设置:', newSettings);
	template.imageDownload = newSettings;
}
