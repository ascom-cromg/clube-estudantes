# Backend Google Apps Script

Este diretório contém o backend do portal do Clube dos Estudantes.

O backend deve ser criado **vinculado à planilha oficial de respostas**. Ele é responsável por:

- localizar o cadastro pelo e-mail;
- enviar código de acesso de 6 dígitos por e-mail;
- devolver apenas os dados do próprio estudante após validação;
- receber endereço completo;
- receber comprovante de matrícula em PDF/JPG/PNG (máximo 5 MB);
- salvar o comprovante na pasta do Google Drive configurada;
- registrar a URL do arquivo na coluna `Comprovante de matrícula (Atualizado)`;
- atualizar status e data da atualização no banco;
- alimentar o painel administrativo com dados consolidados.

## 1. Criar o projeto vinculado

1. Abra a planilha oficial **Clube dos Estudantes de Odontologia de Minas Gerais (respostas)**.
2. Acesse **Extensões > Apps Script**.
3. Apague o conteúdo inicial de `Code.gs`.
4. Cole o conteúdo do arquivo `apps-script/Code.gs` deste repositório.

## 2. Configurar propriedades do script

No Apps Script, abra **Configurações do projeto > Propriedades do script** e crie:

- `PROOF_FOLDER_ID`: ID da pasta do Google Drive onde os comprovantes serão armazenados.
- `ADMIN_PASSWORD`: senha forte para a área administrativa do portal.

Não coloque essas informações no GitHub.

## 3. Executar a configuração inicial

No editor do Apps Script:

1. selecione a função `setupPortal`;
2. clique em **Executar**;
3. autorize o acesso à planilha, Drive e envio de e-mail.

A função registra automaticamente o ID da planilha e cria, se necessário, as colunas administrativas:

- `Última atualização no portal`
- `Status do cadastro`
- `Data do comprovante`
- `Origem da atualização`

## 4. Publicar como Web App

1. Clique em **Implantar > Nova implantação**.
2. Tipo: **Aplicativo da Web**.
3. Executar como: **Você**.
4. Quem pode acessar: **Qualquer pessoa**.
5. Clique em **Implantar** e copie a URL terminada em `/exec`.

Essa URL deve ser inserida em `config.js`:

```js
window.CLUBE_API_URL = "https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec";
```

Após o commit, o GitHub Pages publica a integração automaticamente.

## Segurança

O portal não baixa nem publica a base completa no navegador. O estudante informa o e-mail, recebe um código temporário e só então vê o próprio cadastro. Os comprovantes permanecem privados na pasta do Drive; o backend apenas grava o link na planilha.
