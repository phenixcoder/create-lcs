# create-lcs

A powerful CLI tool for creating Lambda Container Service projects from templates with interactive configuration and automatic setup.

## Features

- 🚀 **Template-based project creation** - Choose from pre-built templates
- 🔧 **Interactive configuration** - Schema-driven prompts for complex setups
- ⚙️ **Automatic setup** - Runs template-specific setup scripts automatically
- 🛡️ **Smart validation** - Built-in validation for AWS Account IDs, project names, and more
- 📝 **Intelligent file handling** - Preserves original template documentation
- 🔄 **Dry-run mode** - Preview changes before applying them
- 🎯 **AWS integration** - Built-in support for AWS credentials and ECR setup

## Installation

```bash
npm install -g create-lcs
# or
pnpm add -g create-lcs
# or
yarn global add create-lcs
```

## Quick Start

```bash
# Create a new Lambda Container Service project
create-lcs

# Preview what would be created (dry-run mode)
create-lcs --dry-run
```

## Usage

### Basic Project Creation

The tool will guide you through an interactive setup process:

1. **Template Selection** - Choose from available templates
2. **Project Configuration** - Set project directory and service name
3. **AWS Setup** - Configure AWS credentials and ECR details
4. **Template Configuration** - Answer template-specific questions (if schema is present)
5. **Automatic Setup** - The tool handles file copying, configuration, and setup

### Template Types

#### Standard Templates
Basic templates that include:
- Project structure
- GitHub Actions workflows
- Basic configuration files

#### Advanced Templates (Schema-based)
Templates with `setup.sh`, `setup.js`, and `.lcsconf.schema.json` files that provide:
- **Interactive configuration** - Schema-driven prompts
- **Automatic validation** - Built-in field validation
- **Custom setup** - Template-specific setup scripts
- **Type conversion** - Automatic handling of strings, numbers, booleans, arrays

### Schema-based Configuration

When a template includes a `.lcsconf.schema.json` file, the tool automatically:

1. **Parses the schema** to generate interactive prompts
2. **Groups questions** by logical sections (PROJECT, AWS, BRANDING, etc.)
3. **Validates input** using schema patterns and formats
4. **Generates `.lcsconf.json`** with your configuration
5. **Runs `pnpm setup`** to apply template-specific customizations

#### Example Schema Structure

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Lambda Container Service Configuration",
  "type": "object",
  "required": ["project", "aws", "branding"],
  "properties": {
    "project": {
      "type": "object",
      "required": ["name", "description"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$",
          "description": "Project name (lowercase, hyphens only)"
        },
        "description": {
          "type": "string",
          "description": "Project description"
        }
      }
    },
    "aws": {
      "type": "object",
      "required": ["accountId", "region"],
      "properties": {
        "accountId": {
          "type": "string",
          "pattern": "^[0-9]{12}$",
          "description": "AWS Account ID (12 digits)"
        },
        "region": {
          "type": "string",
          "description": "Primary AWS region"
        }
      }
    }
  }
}
```

### Command Line Options

- `--dry-run` - Preview what would be created without making any changes

### Supported Schema Features

#### Data Types
- **String** - Text input with optional pattern validation
- **Number/Integer** - Numeric input with automatic conversion
- **Boolean** - Confirm prompts (yes/no)
- **Array** - Comma-separated values that get split into arrays
- **Object** - Nested configuration sections

#### Validation Patterns
- **AWS Account ID** (`^[0-9]{12}$`) - Validates 12-digit AWS account IDs
- **Project Names** (`^[a-z0-9-]+$`) - Lowercase letters, numbers, and hyphens only
- **Hex Colors** (`^#[0-9a-fA-F]{6}$`) - Valid hex color codes
- **URIs** (`format: "uri"`) - Valid URL format validation
- **Custom Patterns** - Any regex pattern with helpful error messages

#### Advanced Features
- **Enum Support** - Dropdown selection from predefined choices
- **Default Values** - Pre-populated fields from schema defaults
- **Nested Objects** - Unlimited nesting levels (e.g., `aws.environments.production`)
- **Required Fields** - Automatic validation of required properties

## File Handling

### Template Files
The tool intelligently handles template files:

- **Copies** all template files except excluded ones
- **Excludes** `node_modules`, `.git`, `dist`, `.vscode`, `.example` files
- **Preserves** original `README.md` as `ORIGINAL_README.md`
- **Preserves** original `todo.md` as `ORIGINAL_todo.md`
- **Handles** LCS setup files (`setup.sh`, `setup.js`, `.lcsconf.schema.json`) separately

### Generated Files
The tool generates:

- **`README.md`** - Project-specific documentation
- **`todo.md`** - Setup instructions for missing configurations
- **`.lcsconf.json`** - Template configuration (if schema present)
- **Modified workflow files** - Updated GitHub Actions with your settings

## Examples

### Basic Usage
```bash
$ create-lcs

Welcome to create-lcs!
? Which template would you like to use? › 
❯ phenixcoder/lambda-container-service
  phenixcoder/lambda-container-service-nest

? Where would you like to create your lambda-container-service project? › my-lcs-service
? What is the name of your service? › my-service
? Do you already have your AWS credentials details? › Yes
? What is your AWS Region? › us-east-1
? What is your AWS IAM Role ARN for OIDC authentication? › arn:aws:iam::123456789012:role/GitHubActionsRole
```

### Schema-based Configuration
When a template has a schema, you'll see additional prompts:

```bash
Template Configuration:
Please provide the following configuration details for this template:

? [PROJECT] Project name (lowercase, hyphens only): › my-awesome-service
? [PROJECT] Project description: › My awesome Lambda container service
? [AWS] AWS Account ID (12 digits): › 123456789012
? [AWS] Primary AWS region: › us-east-1
? [BRANDING] Service display name for UI: › My Awesome Service
? [BRANDING] Primary brand color (hex): › #FF5733

Generated .lcsconf.json with your configuration.
Running template setup...
Template setup completed successfully.
```

### Dry Run Mode
```bash
$ create-lcs --dry-run

Welcome to create-lcs!
Running in dry-run mode. No files will be created or modified.

# ... interactive prompts ...

Dry run: Would clone template repository from https://github.com/phenixcoder/lambda-container-service.git to /tmp/temp-template
Dry run: Would create project directory /current/dir/my-lcs-service
Dry run: Would copy template files...
Dry run: Would set up LCS configuration with schema-based prompts and run pnpm setup
```

## Template Authors

### Creating Schema-based Templates

To create a template that supports advanced configuration:

1. **Add setup files** to your template:
   - `setup.sh` - Shell script for setup tasks
   - `setup.js` - Node.js script for file modifications
   - `.lcsconf.schema.json` - JSON schema defining configuration

2. **Define your schema** following JSON Schema Draft 7:
   ```json
   {
     "$schema": "http://json-schema.org/draft-07/schema#",
     "title": "Your Template Configuration",
     "description": "Configuration for your template",
     "type": "object",
     "required": ["requiredSection"],
     "properties": {
       "requiredSection": {
         "type": "object",
         "properties": {
           "field": {
             "type": "string",
             "description": "Field description for users"
           }
         }
       }
     }
   }
   ```

3. **Implement setup logic** in `setup.js`:
   ```javascript
   const fs = require('fs-extra');
   const config = require('./.lcsconf.json');
   
   // Use config values to modify template files
   console.log(`Setting up ${config.project.name}...`);
   ```

4. **Add package.json script**:
   ```json
   {
     "scripts": {
       "setup": "node setup.js"
     }
   }
   ```

## Requirements

- Node.js 16+ 
- pnpm (for schema-based templates)
- Git (for cloning templates)

## Available Templates

- **phenixcoder/lambda-container-service** - Basic Lambda container service template
- **phenixcoder/lambda-container-service-nest** - NestJS-based Lambda container service template

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
