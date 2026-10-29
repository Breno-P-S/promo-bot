// Formato interno único, independente da plataforma de origem.
// Todo Coletor deve converter a mensagem "crua" da plataforma para isto
// antes de colocar na fila — assim o Processador nunca precisa saber
// se a mensagem veio do Telegram ou de outra fonte futura.
export interface MidiaNormalizada {
  tipo: "imagem" | "video";
  // Para Telegram: file_id (para reenviar sem precisar baixar o arquivo).
  // Para outras plataformas futuras: pode ser uma URL.
  referencia: string;
}

export interface MensagemNormalizada {
  grupoFonteId: string; // id interno (uuid) do registro Grupo na tabela
  idExternoOriginal: string; // id da mensagem na plataforma de origem
  texto: string;
  midias: MidiaNormalizada[];
  linksEncontrados: string[];
}
