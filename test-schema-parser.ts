#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';

// Import the helper functions from index.ts
// Note: In a real scenario, you'd export these from a separate module

// Helper function to convert JSON schema property to prompts question
const convertSchemaPropertyToPrompt = (key: string, property: any): any => {
  const basePrompt = {
    name: key,
    message: property.description || `Enter value for ${key}:`,
  };

  // Handle different types
  switch (property.type) {
    case 'string':
      if (property.enum) {
        return {
          ...basePrompt,
          type: 'select',
          choices: property.enum.map((value: string) => ({ title: value, value })),
          initial: property.default ? property.enum.indexOf(property.default) : 0,
        };
      }
      
      const textPrompt: any = {
        ...basePrompt,
        type: 'text',
        initial: property.default || '',
      };
      
      // Add validation for patterns
      if (property.pattern) {
        textPrompt.validate = (value: string) => {
          const regex = new RegExp(property.pattern);
          return regex.test(value) || `Value must match pattern: ${property.pattern}`;
        };
      }
      
      // Add format-specific validation
      if (property.format === 'uri') {
        textPrompt.validate = (value: string) => {
          try {
            new URL(value);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        };
      }
      
      return textPrompt;
    
    case 'number':
    case 'integer':
      return {
        ...basePrompt,
        type: 'number',
        initial: property.default || 0,
      };
    
    case 'boolean':
      return {
        ...basePrompt,
        type: 'confirm',
        initial: property.default !== undefined ? property.default : true,
      };
    
    case 'array':
      // For arrays, we'll treat them as text input that gets split
      return {
        ...basePrompt,
        type: 'text',
        message: `${property.description || `Enter values for ${key}`} (comma-separated):`,
        initial: property.default ? property.default.join(', ') : '',
      };
    
    default:
      // Default to text for unknown types
      return {
        ...basePrompt,
        type: 'text',
        initial: property.default ? JSON.stringify(property.default) : '',
      };
  }
};

// Helper function to parse JSON schema and generate prompts
const generatePromptsFromSchema = (schema: any): any[] => {
  const promptsArray: any[] = [];
  
  if (schema.properties) {
    for (const [key, property] of Object.entries(schema.properties)) {
      const propSchema = property as any;
      
      if (propSchema.type === 'object' && propSchema.properties) {
        // Handle nested objects by flattening them with prefixed names
        for (const [nestedKey, nestedProperty] of Object.entries(propSchema.properties)) {
          const flattenedKey = `${key}.${nestedKey}`;
          const nestedPropSchema = nestedProperty as any;
          
          // Create prompt with section context
          const prompt = convertSchemaPropertyToPrompt(flattenedKey, nestedPropSchema);
          prompt.message = `[${key.toUpperCase()}] ${prompt.message}`;
          
          promptsArray.push(prompt);
        }
      } else {
        // Handle simple properties
        promptsArray.push(convertSchemaPropertyToPrompt(key, propSchema));
      }
    }
  }
  
  return promptsArray;
};

const test = async () => {
  const schemaPath = path.join(__dirname, '..', 'test-schema.json');
  const schema = await fs.readJson(schemaPath);
  
  console.log('Schema loaded successfully!');
  console.log('Title:', schema.title);
  console.log('Description:', schema.description);
  console.log('\nGenerating prompts...\n');
  
  const prompts = generatePromptsFromSchema(schema);
  
  console.log(`Generated ${prompts.length} prompts:`);
  prompts.forEach((prompt, index) => {
    console.log(`${index + 1}. ${prompt.name}: ${prompt.message} (type: ${prompt.type})`);
    if (prompt.initial !== undefined) {
      console.log(`   Default: ${prompt.initial}`);
    }
    if (prompt.validate) {
      console.log(`   Has validation`);
    }
    console.log('');
  });
};

test().catch(console.error);
