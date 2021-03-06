/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { JSONSchemaType } from 'vs/base/common/jsonSchema';
import { isArray } from 'vs/base/common/types';
import * as nls from 'vs/nls';
import { IConfigurationPropertySchema } from 'vs/platform/configuration/common/configurationRegistry';

type Validator<T> = { enabled: boolean, isValid: (value: T) => boolean; message: string };

function canBeType(propTypes: (string | undefined)[], ...types: JSONSchemaType[]): boolean {
	return types.some(t => propTypes.includes(t));
}

export function createValidator(prop: IConfigurationPropertySchema): (value: any) => (string | null) {
	const type: (string | undefined)[] = Array.isArray(prop.type) ? prop.type : [prop.type];
	const isNullable = canBeType(type, 'null');
	const isNumeric = (canBeType(type, 'number') || canBeType(type, 'integer')) && (type.length === 1 || type.length === 2 && isNullable);

	const numericValidations = getNumericValidators(prop);
	const stringValidations = getStringValidators(prop);
	const stringArrayValidator = getArrayOfStringValidator(prop);

	return value => {
		if (prop.type === 'string' && stringValidations.length === 0) { return null; }
		if (isNullable && value === '') { return ''; }

		const errors: string[] = [];
		if (stringArrayValidator) {
			const err = stringArrayValidator(value);
			if (err) {
				errors.push(err);
			}
		}

		if (isNumeric) {
			if (value === '' || isNaN(+value)) {
				errors.push(nls.localize('validations.expectedNumeric', "Value must be a number."));
			} else {
				errors.push(...numericValidations.filter(validator => !validator.isValid(+value)).map(validator => validator.message));
			}
		}

		if (prop.type === 'string') {
			errors.push(...stringValidations.filter(validator => !validator.isValid('' + value)).map(validator => validator.message));
		}

		if (errors.length) {
			return prop.errorMessage ? [prop.errorMessage, ...errors].join(' ') : errors.join(' ');
		}

		return '';
	};
}

export function getInvalidTypeError(value: any, type: undefined | string | string[]): string | undefined {
	let typeArr = Array.isArray(type) ? type : [type];
	const isNullable = canBeType(typeArr, 'null');
	if (canBeType(typeArr, 'number', 'integer') && (typeArr.length === 1 || typeArr.length === 2 && isNullable)) {
		if (value === '' || isNaN(+value)) {
			return nls.localize('validations.expectedNumeric', "Value must be a number.");
		}
	}

	const valueType = typeof value;
	if (
		(valueType === 'boolean' && !canBeType(typeArr, 'boolean')) ||
		(valueType === 'object' && !canBeType(typeArr, 'object', 'null', 'array')) ||
		(valueType === 'string' && !canBeType(typeArr, 'string', 'number', 'integer')) ||
		(Array.isArray(value) && !canBeType(typeArr, 'array'))
	) {
		if (typeof type !== 'undefined') {
			return nls.localize('invalidTypeError', "Setting has an invalid type, expected {0}. Fix in JSON.", JSON.stringify(type));
		}
	}

	return;
}

function getStringValidators(prop: IConfigurationPropertySchema) {
	let patternRegex: RegExp | undefined;
	if (typeof prop.pattern === 'string') {
		patternRegex = new RegExp(prop.pattern);
	}
	return [
		{
			enabled: prop.maxLength !== undefined,
			isValid: ((value: { length: number; }) => value.length <= prop.maxLength!),
			message: nls.localize('validations.maxLength', "Value must be {0} or fewer characters long.", prop.maxLength)
		},
		{
			enabled: prop.minLength !== undefined,
			isValid: ((value: { length: number; }) => value.length >= prop.minLength!),
			message: nls.localize('validations.minLength', "Value must be {0} or more characters long.", prop.minLength)
		},
		{
			enabled: patternRegex !== undefined,
			isValid: ((value: string) => patternRegex!.test(value)),
			message: prop.patternErrorMessage || nls.localize('validations.regex', "Value must match regex `{0}`.", prop.pattern)
		},
	].filter(validation => validation.enabled);
}

function getNumericValidators(prop: IConfigurationPropertySchema): Validator<number>[] {
	const type: (string | undefined)[] = Array.isArray(prop.type) ? prop.type : [prop.type];

	const isNullable = canBeType(type, 'null');
	const isIntegral = (canBeType(type, 'integer')) && (type.length === 1 || type.length === 2 && isNullable);
	const isNumeric = canBeType(type, 'number', 'integer') && (type.length === 1 || type.length === 2 && isNullable);
	if (!isNumeric) {
		return [];
	}

	let exclusiveMax: number | undefined;
	let exclusiveMin: number | undefined;

	if (typeof prop.exclusiveMaximum === 'boolean') {
		exclusiveMax = prop.exclusiveMaximum ? prop.maximum : undefined;
	} else {
		exclusiveMax = prop.exclusiveMaximum;
	}

	if (typeof prop.exclusiveMinimum === 'boolean') {
		exclusiveMin = prop.exclusiveMinimum ? prop.minimum : undefined;
	} else {
		exclusiveMin = prop.exclusiveMinimum;
	}

	return [
		{
			enabled: exclusiveMax !== undefined && (prop.maximum === undefined || exclusiveMax <= prop.maximum),
			isValid: ((value: number) => value < exclusiveMax!),
			message: nls.localize('validations.exclusiveMax', "Value must be strictly less than {0}.", exclusiveMax)
		},
		{
			enabled: exclusiveMin !== undefined && (prop.minimum === undefined || exclusiveMin >= prop.minimum),
			isValid: ((value: number) => value > exclusiveMin!),
			message: nls.localize('validations.exclusiveMin', "Value must be strictly greater than {0}.", exclusiveMin)
		},

		{
			enabled: prop.maximum !== undefined && (exclusiveMax === undefined || exclusiveMax > prop.maximum),
			isValid: ((value: number) => value <= prop.maximum!),
			message: nls.localize('validations.max', "Value must be less than or equal to {0}.", prop.maximum)
		},
		{
			enabled: prop.minimum !== undefined && (exclusiveMin === undefined || exclusiveMin < prop.minimum),
			isValid: ((value: number) => value >= prop.minimum!),
			message: nls.localize('validations.min', "Value must be greater than or equal to {0}.", prop.minimum)
		},
		{
			enabled: prop.multipleOf !== undefined,
			isValid: ((value: number) => value % prop.multipleOf! === 0),
			message: nls.localize('validations.multipleOf', "Value must be a multiple of {0}.", prop.multipleOf)
		},
		{
			enabled: isIntegral,
			isValid: ((value: number) => value % 1 === 0),
			message: nls.localize('validations.expectedInteger', "Value must be an integer.")
		},
	].filter(validation => validation.enabled);
}

function getArrayOfStringValidator(prop: IConfigurationPropertySchema): ((value: any) => (string | null)) | null {
	if (prop.type === 'array' && prop.items && !isArray(prop.items) && prop.items.type === 'string') {
		const propItems = prop.items;
		if (propItems && !isArray(propItems) && propItems.type === 'string') {
			const withQuotes = (s: string) => `'` + s + `'`;
			return value => {
				if (!value) {
					return null;
				}

				let message = '';

				const stringArrayValue = value as string[];

				if (prop.uniqueItems) {
					if (new Set(stringArrayValue).size < stringArrayValue.length) {
						message += nls.localize('validations.stringArrayUniqueItems', 'Array has duplicate items');
						message += '\n';
					}
				}

				if (prop.minItems && stringArrayValue.length < prop.minItems) {
					message += nls.localize('validations.stringArrayMinItem', 'Array must have at least {0} items', prop.minItems);
					message += '\n';
				}

				if (prop.maxItems && stringArrayValue.length > prop.maxItems) {
					message += nls.localize('validations.stringArrayMaxItem', 'Array must have at most {0} items', prop.maxItems);
					message += '\n';
				}

				if (typeof propItems.pattern === 'string') {
					const patternRegex = new RegExp(propItems.pattern);
					stringArrayValue.forEach(v => {
						if (!patternRegex.test(v)) {
							message +=
								propItems.patternErrorMessage ||
								nls.localize(
									'validations.stringArrayItemPattern',
									'Value {0} must match regex {1}.',
									withQuotes(v),
									withQuotes(propItems.pattern!)
								);
						}
					});
				}

				const propItemsEnum = propItems.enum;
				if (propItemsEnum) {
					stringArrayValue.forEach(v => {
						if (propItemsEnum.indexOf(v) === -1) {
							message += nls.localize(
								'validations.stringArrayItemEnum',
								'Value {0} is not one of {1}',
								withQuotes(v),
								'[' + propItemsEnum.map(withQuotes).join(', ') + ']'
							);
							message += '\n';
						}
					});
				}

				return message;
			};
		}
	}

	return null;
}


