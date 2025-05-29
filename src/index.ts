#!/usr/bin/env node

import prompts from 'prompts';
import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';

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

    // Define files/directories to copy (adjust as needed)
    const filesToCopy = [
      'Dockerfile',
      'package.json',
      '.github/workflows',
      'src', // Assuming source code is in src
      'README.md',
      // Add other config files as needed
    ];

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

    if (!hasAwsCredentials || !hasEcrDetails) {
      if (!isDryRun) {
        const todoContent: string[] = [];
        todoContent.push('# To-Do List for Your New Lambda Container Service Project');
        todoContent.push('');
        todoContent.push('This file outlines the steps you need to take to complete the setup of your project.');
        todoContent.push('');

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
