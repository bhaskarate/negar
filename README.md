# Negar — preparador de PDFs

Site estático em HTML, CSS e JavaScript que adapta o fluxo do script Python `negar`: aceita PDF e imagens, pode dividir páginas duplas, corrigir a inclinação, detectar e recortar margens, uniformizar as dimensões das páginas e gerar PDF com OCR em português.

## Executar localmente

Abra `index.html` no navegador. Para uma experiência mais previsível com workers do PDF.js, recomenda-se servir a pasta por HTTP local, por exemplo:

```bash
python -m http.server 8000
```

Depois acesse `http://localhost:8000`.

## Publicar no GitHub Pages

1. Coloque os arquivos desta pasta na raiz do repositório.
2. No GitHub, abra **Settings → Pages**.
3. Em **Build and deployment**, selecione a branch desejada e a pasta `/ (root)`.
4. Salve. O GitHub Pages publica os arquivos estáticos; não há backend Python.

## O que está incluído

- PDF, PNG, JPG/JPEG, TIFF (inclusive múltiplos quadros), BMP e WEBP.
- Resolução de saída de 150 a 400 DPI (padrão 250).
- Divisão automática de páginas em paisagem; corte manual entre 40% e 60%.
- Correção conservadora de inclinação até ±5° por perfil de projeção.
- Detecção de margens com limite de segurança ajustável entre 1% e 15%; se a detecção for inconclusiva, a página inteira é preservada.
- Centralização e dimensões comuns de saída.
- OCR em português, inglês, espanhol ou português + inglês, com camada de texto invisível.
- Processamento em lote, downloads individuais e ZIP com os resultados.
- Nenhum upload dos documentos para um serviço de processamento.

## Dependências externas

As versões das bibliotecas estão fixadas no `index.html`: PDF.js, pdf-lib, Tesseract.js, JSZip e UTIF. O navegador carrega as bibliotecas e os dados de idioma OCR dos seus distribuidores. A primeira utilização requer conexão com a internet para esses recursos; o conteúdo dos PDFs/imagens permanece local no navegador.

## Observações técnicas

- O Python original usa OpenCV/Hough para estimar inclinação; esta versão usa um perfil de projeção em JavaScript, para evitar incluir outro motor pesado de processamento de imagem. É uma implementação aproximada, portanto convém validar o resultado em documentos com linhas muito tênues ou fotografias.
- A saída é rasterizada na resolução escolhida; o texto reconhecido é sobreposto como camada invisível. Como no script original, o visual depende da resolução de renderização.
- O OCR e a renderização de arquivos grandes podem consumir bastante RAM. Para livros extensos, prefira começar com 200–250 DPI e testar algumas páginas antes de processar o volume inteiro.
