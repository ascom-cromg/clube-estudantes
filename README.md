# Clube dos Estudantes de Odontologia de Minas Gerais

Portal web do Clube dos Estudantes, com foco na campanha **Complete seu cadastro**.

## Arquitetura

- **Front-end:** GitHub Pages
- **Banco de dados:** planilha oficial do Google Sheets
- **Autenticação do estudante:** e-mail + código temporário enviado por e-mail
- **Comprovante de matrícula:** salvo diretamente em pasta privada do Google Drive
- **Backend:** Google Apps Script vinculado à planilha

A base completa não é enviada para o navegador. O estudante informa o e-mail usado na inscrição, recebe um código de 6 dígitos e só depois acessa o próprio cadastro.

## Fluxo do estudante

1. Informar o e-mail cadastrado.
2. Receber e validar o código de acesso.
3. Conferir nome, telefone, instituição e período já registrados.
4. Preencher endereço completo.
5. Enviar comprovante de matrícula atualizado (PDF/JPG/PNG, até 5 MB).
6. O backend salva o arquivo no Drive e registra o link na planilha.

## Áreas do portal

- Login por e-mail
- Verificação por código
- Início
- Meu Perfil / Complete seu cadastro
- Painel Administrativo protegido por senha

## Backend

O código do backend e as instruções de implantação estão em:

`apps-script/`

Após publicar o Apps Script como Web App, a URL `/exec` deve ser inserida em `config.js`.

## Publicação

A branch `main` é publicada automaticamente no GitHub Pages por GitHub Actions.

Portal:

`https://ascom-cromg.github.io/clube-estudantes/`
