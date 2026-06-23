import { Spreadsheet } from "../types";

export const DEFAULT_SPREADSHEETS: Spreadsheet[] = [
  {
    id: "sheet-conselheiros",
    name: "Conselheiros das Organizações",
    rawFileName: "conselheiros_empresas_juniores.xlsx",
    updatedAt: new Date().toLocaleDateString("pt-BR"),
    tabs: [
      {
        name: "Geral",
        headers: ["Empresa", "Conselheiro", "Cargo", "Contato Telefone", "E-mail de Trabalho", "Setor"],
        rows: [
          {
            "Empresa": "Adm Consult",
            "Conselheiro": "Carlos Alberto Silva",
            "Cargo": "Conselheiro Sênior de Negócios",
            "Contato Telefone": "(11) 98765-4321",
            "E-mail de Trabalho": "carlos.silva@admconsult.com.br",
            "Setor": "Administração & Estratégia"
          },
          {
            "Empresa": "Tech Jr",
            "Conselheiro": "Mariana Mendes Souza",
            "Cargo": "Conselheira Orientadora de TI",
            "Contato Telefone": "(21) 99888-7766",
            "E-mail de Trabalho": "mariana.souza@techjr.com",
            "Setor": "Tecnologia & Desenvolvimento de Software"
          },
          {
            "Empresa": "Pontual Engenharia",
            "Conselheiro": "Felipe Dutra Neto",
            "Cargo": "Orientador Técnico Civil",
            "Contato Telefone": "(31) 97777-6655",
            "E-mail de Trabalho": "felipe.neto@pontualeng.com.br",
            "Setor": "Engenharia & Infraestrutura"
          },
          {
            "Empresa": "Marketing Pro",
            "Conselheiro": "Beatriz Martins",
            "Cargo": "Conselheira de Tração & Growth",
            "Contato Telefone": "(11) 95544-3322",
            "E-mail de Trabalho": "beatriz.m@mktpro.com",
            "Setor": "Comunicação & Vendas"
          }
        ]
      },
      {
        name: "Conselho_Gestor",
        headers: ["Região", "Presidente", "Contato", "Status da Gestão"],
        rows: [
          {
            "Região": "Sudeste",
            "Presidente": "Roberto Justo",
            "Contato": "(11) 90001-1122",
            "Status da Gestão": "Ativo"
          },
          {
            "Região": "Nordeste",
            "Presidente": "Alcione Cavalcante",
            "Contato": "(81) 90001-3344",
            "Status da Gestão": "Ativo"
          }
        ]
      }
    ]
  },
  {
    id: "sheet-manual-emergencia",
    name: "Manual de Emergência e Logística",
    rawFileName: "manual_emergencia_evento_v2.csv",
    updatedAt: new Date().toLocaleDateString("pt-BR"),
    tabs: [
      {
        name: "Protocolos_Saude",
        headers: ["Ocorrência de Emergência", "Conduta Recomendada", "Responsável Logístico", "Telefone de Plantão"],
        rows: [
          {
            "Ocorrência de Emergência": "Congressista passando mal",
            "Conduta Recomendada": "Encaminhar imediatamente ao posto médico localizado na Arena Principal (Pavilhão A, ao lado do credenciamento). Se o paciente estiver inconsciente ou incapaz de andar, NÃO movê-lo, acionar imediatamente o SAMU (192) e avisar de imediato a coordenação de logística para liberar a entrada da ambulância pela Portaria 3.",
            "Responsável Logístico": "Ana Clara Martins (Coordenação Médica Geral)",
            "Telefone de Plantão": "(11) 91111-2222"
          },
          {
            "Ocorrência de Emergência": "Perda ou extravio de crachá de acesso",
            "Conduta Recomendada": "Direcionar a pessoa à mesa de credenciamento oficial na recepção do Pavilhão B. O congressista deve apresentar um documento de identificação com foto. A emissão de segunda via de crachá tem taxa de R$ 20,00.",
            "Responsável Logístico": "Vitor Santos (Credenciamento & Recepção)",
            "Telefone de Plantão": "(11) 93333-4444"
          },
          {
            "Ocorrência de Emergência": "Incêndio ou Alarme de fumaça acionado",
            "Conduta Recomendada": "Manter a calma, orientar a evacuação imediata do pavilhão utilizando as saídas de emergência demarcadas pelas placas fotoluminescentes. Concentrar todo o grupo no ponto de encontro do estacionamento externo. Seguir orientações dos brigadistas.",
            "Responsável Logístico": "Tenente Ricardo (Responsável Segurança do Espaço)",
            "Telefone de Plantão": "(11) 94444-5555"
          }
        ]
      }
    ]
  },
  {
    id: "sheet-contingencia-fornecedores",
    name: "Contingência de Fornecedores",
    rawFileName: "plano_contingencia_fornecedores_ativos.xlsx",
    updatedAt: new Date().toLocaleDateString("pt-BR"),
    tabs: [
      {
        name: "Fornecedores_Principais",
        headers: ["Serviço/Categoria", "Fornecedor Ativo", "Contato Ativo", "Status de Risco de Atraso", "O que fazer se não entregar/atrasar", "Fornecedor Reserva de Backup", "Contato Backup Urgente"],
        rows: [
          {
            "Serviço/Categoria": "Equipamentos de som (Palco Principal)",
            "Fornecedor Ativo": "AudioTech Eventos",
            "Contato Ativo": "Julio (11) 99333-2211",
            "Status de Risco de Atraso": "Médio",
            "O que fazer se não entregar/atrasar": "Se o fornecedor de equipamentos de som não entregar o combinado ou atrasar em mais de 30 minutos a montagem do som de som, acionar imediatamente o fornecedor de backup 'Som & Luz Express'. Eles já estão de prontidão com um kit de som médio carregado no caminhão para entrega em até 1 hora no local.",
            "Fornecedor Reserva de Backup": "Som & Luz Express",
            "Contato Backup Urgente": "(11) 95555-5555 (Falar com Marcos)"
          },
          {
            "Serviço/Categoria": "Catering & Coffee Break",
            "Fornecedor Ativo": "Delícias Buffet",
            "Contato Ativo": "Sônia (11) 99111-8888",
            "Status de Risco de Atraso": "Baixo",
            "O que fazer se não entregar/atrasar": "Interromper serviço, notificar a coordenação de alimentação sobre o remanejamento dos intervalos e acionar o buffet reserva 'SuperLanches' para entrega expressa de kits individuais de lanches.",
            "Fornecedor Reserva de Backup": "SuperLanches Express",
            "Contato Backup Urgente": "(11) 96666-6666 (Falar com Atendimento de Emergências)"
          },
          {
            "Serviço/Categoria": "Painéis de LED / Projeção",
            "Fornecedor Ativo": "VisualPro Displays",
            "Contato Ativo": "Amanda (11) 98222-1100",
            "Status de Risco de Atraso": "Alto",
            "O que fazer se não entregar/atrasar": "Em caso de falha técnica severa ou ausência total de entrega das placas de LED, solicitar instalação imediata das duas telas de projeção de back-up que estão na marcenaria técnica (Sala 4A) e configurar os projetores móveis sobressalentes.",
            "Fornecedor Reserva de Backup": "LED Backup Locações",
            "Contato Backup Urgente": "(11) 94433-2211"
          }
        ]
      }
    ]
  }
];
