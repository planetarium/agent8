# Remote Container Protocol

Protocol definitions for remote container communication between client and server projects.

## Overview

This repository contains shared type definitions and interfaces used for communication between client applications and server-side container services.

## Features

- Self-contained protocol definitions
- No external dependencies
- TypeScript interfaces and types
- Shared between client and server projects

## Usage

### For client projects:

```bash
git subtree add --prefix=path/to/client/protocol https://your-git-url/remote-container-protocol.git main --squash
```

### For server projects:

```bash
git subtree add --prefix=path/to/server/protocol https://your-git-url/remote-container-protocol.git main --squash
```

## Updating

To update the subtree in your project:

```bash
git subtree pull --prefix=path/to/protocol https://your-git-url/remote-container-protocol.git main --squash
```

## Contributing

To contribute changes from your project back to the shared protocol:

```bash
git subtree push --prefix=path/to/protocol https://your-git-url/remote-container-protocol.git main
``` 