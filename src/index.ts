#!/usr/bin/env node

import prompts from 'prompts';
import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';

// Helper function to convert JSON schema property to prompts question
const convertSchemaPropertyToPrompt = (key: string, property: any): prompts.PromptObject => {
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
      
      // Add specific validation for common patterns
      if (property.pattern === '^[0-9]{12}$') {
        textPrompt.validate = (value: string) => {
          return /^[0-9]{12}$/.test(value) || 'AWS Account ID must be exactly 12 digits';
        };
      } else if (property.pattern === '^[a-z0-9-]+$') {
        textPrompt.validate = (value: string) => {
          return /^[a-z0-9-]+$/.test(value) || 'Must contain only lowercase letters, numbers, and hyphens';
        };
      } else if (property.pattern === '^#[0-9a-fA-F]{6}$') {
        textPrompt.validate = (value: string) => {
          return /^#[0-9a-fA-F]{6}$/.test(value) || 'Must be a valid hex color (e.g., #FF5733)';
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
const generatePromptsFromSchema = (schema: any, prefix: string = ''): prompts.PromptObject[] => {
  const promptsArray: prompts.PromptObject[] = [];
  
  if (schema.properties) {
    for (const [key, property] of Object.entries(schema.properties)) {
      const propSchema = property as any;
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (propSchema.type === 'object' && propSchema.properties) {
        // Recursively handle nested objects
        const nestedPrompts = generatePromptsFromSchema(propSchema, fullKey);
        promptsArray.push(...nestedPrompts);
      } else {
        // Handle simple properties
        const prompt = convertSchemaPropertyToPrompt(fullKey, propSchema);
        
        // Add section context for nested properties
        if (prefix) {
          const sections = prefix.split('.');
          const sectionLabel = sections.map(s => s.toUpperCase()).join(' > ');
          prompt.message = `[${sectionLabel}] ${prompt.message}`;
        }
        
        promptsArray.push(prompt);
      }
    }
  }
  
  return promptsArray;
};

// Helper function to set nested value in object using dot notation
const setNestedValue = (obj: any, path: string, value: any) => {
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[keys[keys.length - 1]] = value;
};

// Helper function to process a single value based on schema type
const processValue = (value: any, propSchema: any): any => {
  if (value === undefined) {
    return propSchema.default;
  }
  
  if (propSchema.type === 'array' && typeof value === 'string') {
    return value.split(',').map((item: string) => item.trim()).filter(Boolean);
  } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
    return Number(value);
  } else if (propSchema.type === 'boolean') {
    return Boolean(value);
  } else {
    return value;
  }
};

// Helper function to process prompt responses into config object
const processResponsesForConfig = (responses: any, schema: any): any => {
  const config: any = {};
  
  // First, set all default values for properties that have them
  const setDefaults = (currentSchema: any, prefix: string = '') => {
    if (currentSchema.properties) {
      for (const [key, property] of Object.entries(currentSchema.properties)) {
        const propSchema = property as any;
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        if (propSchema.type === 'object' && propSchema.properties) {
          // Recursively handle nested objects
          setDefaults(propSchema, fullKey);
        } else if (propSchema.default !== undefined) {
          // Set default value
          setNestedValue(config, fullKey, propSchema.default);
        }
      }
    }
  };
  
  // Set defaults first
  setDefaults(schema);
  
  // Then override with user responses
  for (const [flattenedKey, response] of Object.entries(responses)) {
    if (response !== undefined) {
      // Find the schema for this key by walking the path
      const keys = flattenedKey.split('.');
      let currentSchema = schema;
      
      for (const key of keys) {
        if (currentSchema.properties && currentSchema.properties[key]) {
          currentSchema = currentSchema.properties[key];
        }
      }
      
      // Process the value and set it in the config
      const processedValue = processValue(response, currentSchema);
      setNestedValue(config, flattenedKey, processedValue);
    }
  }
  
  return config;
};

// Helper function to run command with promise
const runCommand = (command: string, args: string[], cwd: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd, stdio: 'inherit' });
    
    process.on('close', (code: number) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    process.on('error', (err: Error) => {
      reject(err);
    });
  });
};

const run = async () => {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('Welcome to create-lcs!');
  if (isDryRun) {
    console.log('Running in dry-run mode. No files will be created or modified.');
  }

  const questions: prompts.PromptObject[] = [
    {
      type: 'select',
      name: 'template',
      message: 'Which template would you like to use?',
      choices: [
        { title: 'phenixcoder/lambda-container-service', value: 'https://github.com/phenixcoder/lambda-container-service.git' },
        { title: 'phenixcoder/lambda-container-service-nest', value: 'https://github.com/phenixcoder/lambda-container-service-nest.git' },
      ],
      initial: 0,
    },
    {
      type: 'text',
      name: 'projectDir',
      message: 'Where would you like to create your lambda-container-service project?',
      initial: 'my-lcs-service',
    },
    {
      type: 'text',
      name: 'serviceName',
      message: 'What is the name of your service?',
      initial: 'my-service',
    },
    {
      type: 'confirm',
      name: 'hasAwsCredentials',
      message: 'Do you already have your AWS credentials details (Region, IAM Role ARN or Access Keys) for GitHub Actions?',
      initial: true,
    },
    {
      type: (prev: boolean) => prev ? 'text' : null, // Only ask if hasAwsCredentials is true
      name: 'awsRegion',
      message: 'What is your AWS Region?',
    },
    {
      type: (prev: string) => prev ? 'text' : null, // Only ask if awsRegion was answered (meaning hasAwsCredentials was true)
      name: 'awsRoleArn',
      message: 'What is your AWS IAM Role ARN for OIDC authentication?',
    },
    {
      type: 'confirm',
      name: 'hasEcrDetails',
      message: 'Do you already have your ECR repository name?',
      initial: true,
    },
    {
      type: (prev: boolean) => prev ? 'text' : null, // Only ask if hasEcrDetails is true
      name: 'ecrRepoName',
      message: 'What is your ECR repository name?',
    },
  ];

  const response = await prompts(questions);

  const projectDir = response.projectDir;
  const serviceName = response.serviceName;
  const hasAwsCredentials = response.hasAwsCredentials;
  const awsRegion = response.awsRegion;
  const awsRoleArn = response.awsRoleArn;
  const hasEcrDetails = response.hasEcrDetails;
  const ecrRepoName = response.ecrRepoName;
  const templateRepoUrl = response.template; // Use the selected template URL

  console.log('\nCreating project with the following details:');
  console.log(`Project Directory: ${projectDir}`);
  console.log(`Service Name: ${serviceName}`);
  if (hasAwsCredentials) {
    console.log(`AWS Region: ${awsRegion}`);
    console.log(`AWS Role ARN: ${awsRoleArn}`);
  } else {
    console.log('AWS credentials details will be added to todo.md');
  }
  if (hasEcrDetails) {
    console.log(`ECR Repository Name: ${ecrRepoName}`);
  } else {
    console.log('ECR repository name will be added to todo.md');
  }

  const confirmQuestion: prompts.PromptObject = {
    type: 'confirm',
    name: 'confirm',
    message: 'Proceed with project creation?',
    initial: true,
  };

  const confirmResponse = await prompts(confirmQuestion);

  if (!confirmResponse.confirm) {
    console.log('Project creation cancelled.');
    return;
  }

  const tempDir = path.join(__dirname, '..', 'temp-template');
  const projectPath = path.join(process.cwd(), projectDir);

  try {
    // Clean up temporary directory if it exists
    if (!isDryRun) {
      await fs.emptyDir(tempDir);
    } else {
      console.log(`Dry run: Would clean up temporary directory ${tempDir}`);
    }

    console.log(`Cloning template repository from ${templateRepoUrl}...`);
    // Clone the template repository
    if (!isDryRun) {
      await new Promise<void>((resolve, reject) => {
        const gitClone = spawn('git', ['clone', templateRepoUrl, tempDir]);

        gitClone.on('close', (code: number) => {
          if (code === 0) {
            console.log('Cloning complete.');
            resolve();
          } else {
            reject(`git clone failed with code ${code}`);
          }
        });

        gitClone.on('error', (err: Error) => {
          reject(err);
        });
      });
    } else {
      console.log(`Dry run: Would clone template repository from ${templateRepoUrl} to ${tempDir}`);
    }

    console.log(`Copying template files to ${projectPath}...`);
    // Create the project directory
    if (!isDryRun) {
      await fs.ensureDir(projectPath);
    } else {
      console.log(`Dry run: Would create project directory ${projectPath}`);
    }

    // Copy everything from the template directory to the project directory. Just ignote node_modules and .git directories and files have .example suffix or TEMPLATE_ prefix.
    const filesToCopy = await fs.readdir(tempDir);
    // Filter out files and directories that should not be copied
    const filteredFiles = filesToCopy.filter(file => {
      const filePath = path.join(tempDir, file);
      return !file.startsWith('node_modules') &&
             !file.startsWith('.git') &&
             !file.startsWith('dist') &&
             !file.startsWith('.vscode') &&
             !file.endsWith('.example') &&
             !file.startsWith('TEMPLATE_') &&
             !file.startsWith('README.md') && // Exclude README.md to avoid conflicts
             !file.startsWith('todo.md') && // Exclude todo.md to avoid conflicts
             file !== 'setup.sh' && // Exclude LCS setup files - handled separately
             file !== 'setup.js' && 
             file !== '.lcsconf.schema.json';
    });

    for (const file of filesToCopy) {
      const sourcePath = path.join(tempDir, file);
      const destinationPath = path.join(projectPath, file);
      if (await fs.exists(sourcePath)) {
        if (!isDryRun) {
          await fs.copy(sourcePath, destinationPath);
          console.log(`Copied ${file}`);
        } else {
          console.log(`Dry run: Would copy ${sourcePath} to ${destinationPath}`);
        }
      } else {
        console.warn(`Warning: Template file/directory not found: ${file}`);
      }
    }

    // Handle existing README.md and todo.md files from template
    console.log('Checking for existing README.md and todo.md files from template...');
    const templateReadmePath = path.join(tempDir, 'README.md');
    const templateTodoPath = path.join(tempDir, 'todo.md');
    const projectReadmePath = path.join(projectPath, 'README.md');
    const projectTodoPath = path.join(projectPath, 'todo.md');
    
    let hasOriginalReadme = false;
    let hasOriginalTodo = false;

    if (await fs.exists(templateReadmePath)) {
      if (!isDryRun) {
        await fs.copy(templateReadmePath, path.join(projectPath, 'ORIGINAL_README.md'));
        hasOriginalReadme = true;
        console.log('Renamed template README.md to ORIGINAL_README.md');
      } else {
        console.log('Dry run: Would rename template README.md to ORIGINAL_README.md');
        hasOriginalReadme = true;
      }
    }

    if (await fs.exists(templateTodoPath)) {
      if (!isDryRun) {
        await fs.copy(templateTodoPath, path.join(projectPath, 'ORIGINAL_todo.md'));
        hasOriginalTodo = true;
        console.log('Renamed template todo.md to ORIGINAL_todo.md');
      } else {
        console.log('Dry run: Would rename template todo.md to ORIGINAL_todo.md');
        hasOriginalTodo = true;
      }
    }

    // Check for LCS configuration setup files
    console.log('Checking for LCS configuration setup files...');
    const setupShPath = path.join(tempDir, 'setup.sh');
    const setupJsPath = path.join(tempDir, 'setup.js');
    const schemaPath = path.join(tempDir, '.lcsconf.schema.json');
    
    const hasSetupSh = await fs.exists(setupShPath);
    const hasSetupJs = await fs.exists(setupJsPath);
    const hasSchema = await fs.exists(schemaPath);

    if (hasSetupSh && hasSetupJs && hasSchema) {
      console.log('Detected LCS configuration setup files. Setting up configuration...');
      
      if (!isDryRun) {
        // Copy the setup files to project directory
        await fs.copy(setupShPath, path.join(projectPath, 'setup.sh'));
        await fs.copy(setupJsPath, path.join(projectPath, 'setup.js'));
        await fs.copy(schemaPath, path.join(projectPath, '.lcsconf.schema.json'));
        
        // Read and parse the schema
        const schemaContent = await fs.readJson(schemaPath);
        console.log('Parsing configuration schema...');
        
        // Generate prompts from schema
        const configQuestions = generatePromptsFromSchema(schemaContent);
        
        if (configQuestions.length > 0) {
          console.log('\nTemplate Configuration:');
          console.log('Please provide the following configuration details for this template:');
          
          const configResponses = await prompts(configQuestions);
          
          // Process responses and generate config
          const config = processResponsesForConfig(configResponses, schemaContent);
          
          // Write .lcsconf.json
          const configPath = path.join(projectPath, '.lcsconf.json');
          await fs.writeJson(configPath, config, { spaces: 2 });
          console.log('Generated .lcsconf.json with your configuration.');
          
          // Run pnpm setup
          console.log('Running template setup...');
          try {
            await runCommand('pnpm', ['setup'], projectPath);
            console.log('Template setup completed successfully.');
          } catch (error) {
            console.warn('Warning: Template setup failed:', error);
            console.log('You may need to run "pnpm setup" manually in your project directory.');
          }
        } else {
          console.log('No configuration questions found in schema.');
        }
      } else {
        console.log('Dry run: Would set up LCS configuration with schema-based prompts and run pnpm setup');
      }
    } else if (hasSetupSh || hasSetupJs || hasSchema) {
      console.log('Warning: Partial LCS setup files detected. Expected setup.sh, setup.js, and .lcsconf.schema.json');
      if (hasSetupSh) console.log('Found: setup.sh');
      if (hasSetupJs) console.log('Found: setup.js');
      if (hasSchema) console.log('Found: .lcsconf.schema.json');
    }

    console.log('Modifying package.json...');
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (await fs.exists(packageJsonPath)) {
      if (!isDryRun) {
        const packageJson = await fs.readJson(packageJsonPath);
        packageJson.name = serviceName;
        // TODO: Add other necessary modifications to package.json
        await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
        console.log('Modified package.json.');
      } else {
        console.log(`Dry run: Would modify package.json at ${packageJsonPath} with service name ${serviceName}`);
      }
    } else {
      console.warn('Warning: package.json not found in template.');
    }

    console.log('Modifying GitHub Actions workflow files...');
    const workflowsDir = path.join(projectPath, '.github', 'workflows');
    if (await fs.exists(workflowsDir)) {
      const workflowFiles = await fs.readdir(workflowsDir);

      for (const file of workflowFiles) {
        if (file.endsWith('.yml') || file.endsWith('.yaml')) {
          const workflowFilePath = path.join(workflowsDir, file);
          if (!isDryRun) {
            let workflowContent = await fs.readFile(workflowFilePath, 'utf8');

            // TODO: Implement modifications based on user input
            // Replace service name placeholder
            workflowContent = workflowContent.replace(/YOUR_SERVICE_NAME_PLACEHOLDER/g, serviceName);

            // Configure AWS Region and Role ARN if provided
            if (hasAwsCredentials && awsRegion && awsRoleArn) {
              workflowContent = workflowContent.replace(/YOUR_AWS_REGION_PLACEHOLDER/g, awsRegion);
              workflowContent = workflowContent.replace(/YOUR_AWS_ROLE_ARN_PLACEHOLDER/g, awsRoleArn);
            } else if (!hasAwsCredentials) {
              workflowContent = '# TODO: Configure AWS credentials (region, role ARN or secrets) - see todo.md\n' + workflowContent;
            }

            // Configure ECR Repository Name if provided
            if (hasEcrDetails && ecrRepoName) {
              workflowContent = workflowContent.replace(/YOUR_ECR_REPO_NAME_PLACEHOLDER/g, ecrRepoName);
            } else if (!hasEcrDetails) {
              workflowContent = '# TODO: Configure ECR repository name - see todo.md\n' + workflowContent;
            }

            await fs.writeFile(workflowFilePath, workflowContent, 'utf8');
            console.log(`Modified ${file}`);
          } else {
            console.log(`Dry run: Would modify GitHub Actions workflow file ${workflowFilePath}`);
          }
        }
      }
    } else {
      console.warn('Warning: .github/workflows directory not found in template.');
    }

    console.log('Modifying other configuration files...');
    // TODO: Identify and modify other configuration files as needed based on the template structure.
    // Examples: Dockerfile (if needed), service-specific config files, IaC files.
    console.log('Finished modifying other configuration files (placeholder).');

    if (!hasAwsCredentials || !hasEcrDetails || hasOriginalTodo) {
      if (!isDryRun) {
        const todoContent: string[] = [];
        todoContent.push('# To-Do List for Your New Lambda Container Service Project');
        todoContent.push('');
        todoContent.push('This file outlines the steps you need to take to complete the setup of your project.');
        todoContent.push('');

        if (hasOriginalTodo) {
          todoContent.push('> **Note:** The original todo.md from the template has been preserved as [ORIGINAL_todo.md](./ORIGINAL_todo.md). You may want to review it for template-specific instructions.');
          todoContent.push('');
        }

        if (!hasAwsCredentials) {
          todoContent.push('## Configure AWS Credentials for GitHub Actions');
          todoContent.push('');
          todoContent.push('You need to configure AWS credentials for your GitHub Actions workflow. The recommended approach is using IAM roles with OIDC. Follow these steps:');
          todoContent.push('');
          todoContent.push('1.  **Create an IAM Role:** In your AWS account, create an IAM role that your GitHub Actions workflow can assume. This role should have permissions to build and push Docker images to ECR and potentially deploy your Lambda function.');
          todoContent.push('2.  **Configure Trust Relationship:** Configure the trust relationship for the IAM role to allow the GitHub OIDC provider to assume the role. You will need your GitHub organization and repository name.');
          todoContent.push('3.  **Update GitHub Actions Workflow:** Update the GitHub Actions workflow file (`.github/workflows/main.yml` or similar) with the correct AWS region and the ARN of the IAM role you created.');
          todoContent.push('');
          todoContent.push('Alternatively, you can use AWS access key ID and secret access key stored as GitHub secrets, but this is less secure.');
          todoContent.push('');
        }

        if (!hasEcrDetails) {
          todoContent.push('## Set up Amazon Elastic Container Registry (ECR)');
          todoContent.push('');
          todoContent.push('You need an ECR repository to store your Docker image. Follow these steps:');
          todoContent.push('');
          todoContent.push('1.  **Create an ECR Repository:** In your AWS account, create a new ECR repository. Note the repository name.');
          todoContent.push('2.  **Update GitHub Actions Workflow:** Update the GitHub Actions workflow file (`.github/workflows/main.yml` or similar) with your ECR repository name.');
          todoContent.push('');
        }

        // If we only have an original todo and no missing credentials, add a note about project completion
        if (hasOriginalTodo && hasAwsCredentials && hasEcrDetails) {
          todoContent.push('## Project Setup Complete');
          todoContent.push('');
          todoContent.push('All required AWS credentials and ECR details have been configured. Your project should be ready to deploy!');
          todoContent.push('');
          todoContent.push('Please review the original template todo.md file (linked above) for any template-specific setup steps that may still be required.');
          todoContent.push('');
        }

        const todoFilePath = path.join(projectPath, 'todo.md');
        await fs.writeFile(todoFilePath, todoContent.join('\n'), 'utf8');
        console.log('Created todo.md with instructions.');
      } else {
        console.log(`Dry run: Would create todo.md at ${path.join(projectPath, 'todo.md')} with setup instructions.`);
      }
    }

    console.log('Generating README.md...');
    if (!isDryRun) {
      const readmeContent: string[] = [];
      readmeContent.push(`# ${serviceName}`);
      readmeContent.push('');
      readmeContent.push('This is your new Lambda Container Service project.');
      readmeContent.push('');

      if (hasOriginalReadme) {
        readmeContent.push('> **Note:** The original README.md from the template has been preserved as [ORIGINAL_README.md](./ORIGINAL_README.md). You may want to review it for template-specific information and instructions.');
        readmeContent.push('');
      }

      readmeContent.push('## AWS Setup');
      readmeContent.push('');
      if (hasAwsCredentials) {
        readmeContent.push(`AWS Region: ${awsRegion}`);
        readmeContent.push(`AWS IAM Role ARN for OIDC: ${awsRoleArn}`);
        readmeContent.push('');
        readmeContent.push('These details are configured in your GitHub Actions workflow files (`.github/workflows/`). Ensure the IAM role has the necessary permissions and the trust relationship is correctly configured for your GitHub repository.');
      } else {
        readmeContent.push('AWS credentials details were not provided during setup.');
        readmeContent.push('Please refer to the `todo.md` file for detailed instructions on configuring AWS credentials (IAM role with OIDC is recommended) for your GitHub Actions workflow.');
      }
      readmeContent.push('');
      readmeContent.push('## ECR Setup');
      readmeContent.push('');
      if (hasEcrDetails) {
        readmeContent.push(`ECR Repository Name: ${ecrRepoName}`);
        readmeContent.push('');
        readmeContent.push('This ECR repository name is configured in your GitHub Actions workflow files (`.github/workflows/`). Ensure this repository exists in your AWS account.');
      } else {
        readmeContent.push('ECR repository name was not provided during setup.');
        readmeContent.push('Please refer to the `todo.md` file for detailed instructions on creating an ECR repository.');
      }
      readmeContent.push('');
      readmeContent.push('## Getting Started');
      readmeContent.push('');
      readmeContent.push(`1. Navigate to your project directory: \`cd ${projectDir}\``);
      readmeContent.push('2. Review the generated files, especially the GitHub Actions workflow(s) in `.github/workflows/`.');
      readmeContent.push('3. Create a new GitHub repository and push your code.');
      readmeContent.push('4. If you did not provide all AWS/ECR details during setup, follow the instructions in `todo.md`.');
      readmeContent.push('5. Configure necessary GitHub secrets (e.g., `AWS_ROLE_ARN` if using OIDC, or `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` if not using OIDC).');
      readmeContent.push('6. Trigger your GitHub Actions workflow to build and deploy your Lambda container service.');
      readmeContent.push('');

      const readmeFilePath = path.join(projectPath, 'README.md');
      await fs.writeFile(readmeFilePath, readmeContent.join('\n'), 'utf8');
      console.log('Generated README.md.');
    } else {
      console.log(`Dry run: Would generate README.md at ${path.join(projectPath, 'README.md')} with project details and instructions.`);
    }

  } catch (error) {
    console.error('Error during project creation:', error);
  } finally {
    // Clean up temporary directory
    await fs.remove(tempDir);
    console.log('Cleaned up temporary directory.');
  }

  console.log('\nProject setup complete!');
  console.log(`Next steps: cd ${projectDir}, review files, create GitHub repository, push code.`);
};

run();
