# 🚀 Deploy Incidents App – GitHub Actions Pipeline

This repository contains a GitHub Actions workflow for deploying the **Incidents App** in two modes:
- **Single Tenant (ST)**
- **Multitenant (MTX)**

---
## ⚙️ How the Pipeline Works

The pipeline is triggered by:
- **Pushes** to the `main` branch.
- **Pull Request (PR)** activities:
  - Opened
  - Reopened
  - Synchronized
  - Labeled
- **Manual triggers** via the **workflow_dispatch** option (in GitHub UI).

> **Note:** Deployment **only occurs** if a specific label is attached to the PR.

---

## 🏷️ Available Labels

| Label        | Action Performed                         |
|--------------|------------------------------------------|
| `deploy-ST`  | Deploys the Single Tenant version        |
| `deploy-MTX` | Deploys the Multitenant (MTX) version     |

---

## 🛠️ How to Trigger a Deployment on a PR

1. **Create a Pull Request** from your feature/bugfix branch into `main`.
2. **Add one of the following labels** to the PR:
   - `deploy-ST` → triggers deployment of the Single Tenant app.
   - `deploy-MTX` → triggers deployment of the Multitenant app.
   
   > _Tip:_ Labels can be added in the PR sidebar under the **"Labels"** section.

3. **Pipeline Execution**: Once the label is added, the corresponding deploy job will start automatically.
4. **Post Deployment**: After a successful deployment, the pipeline will **add a comment** on your PR with a link to the deployed application.

---

## ⚡ Important Notes

- Without a deployment label, **no deployment will occur**.
- Removing the label **does not rollback** an already started deployment.
- The deployment uses **Cloud Foundry credentials** securely stored as **GitHub Secrets**.

---

## 🔒 Secrets and Environment Variables

| Secret Name    | Purpose                                     |
|----------------|---------------------------------------------|
| `CF_API_ST`     | Cloud Foundry API endpoint for Single Tenant |
| `CF_USERNAME_ST`| CF username for Single Tenant               |
| `CF_PASSWORD_ST`| CF password for Single Tenant               |
| `CF_ORG_ST`     | CF organization for Single Tenant           |
| `CF_SPACE_ST`   | CF space for Single Tenant                  |
| `CF_API_MT`     | Cloud Foundry API endpoint for MTX          |
| `CF_USERNAME_MT`| CF username for MTX                         |
| `CF_PASSWORD_MT`| CF password for MTX                         |
| `CF_ORG_MT`     | CF organization for MTX                     |
| `CF_SPACE_MT`   | CF space for MTX                            |

---

## 📋 Quick Example

1. Push your changes to a new branch.
2. Open a Pull Request targeting `main`.
3. Add the label `deploy-ST` (or `deploy-MTX`).
4. The GitHub Actions pipeline triggers automatically and deploys your app.
5. A comment will be posted on the PR with a link to the deployed application, for example: